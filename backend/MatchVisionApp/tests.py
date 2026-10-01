from datetime import timedelta
from io import StringIO

from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from .models import AuthToken, Match, Player, Team


def client_with(token=None):
    client = APIClient()
    if token:
        client.credentials(HTTP_AUTHORIZATION=f'Token {token}')
    return client


class AccountTests(APITestCase):

    def setUp(self):
        cache.clear()  # throttle counters

    def register(self, email='coach@example.com', password='Pallavolo-2026'):
        return self.client.post('/auth/register/', {'email': email, 'password': password, 'name': 'Anna'}, format='json')

    def test_register_and_login(self):
        res = self.register('Coach@Example.com ')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['user']['email'], 'coach@example.com')
        me = client_with(res.data['token']).get('/auth/me/')
        self.assertEqual(me.data['name'], 'Anna')

        res = self.client.post('/auth/login/', {'email': 'COACH@example.com', 'password': 'Pallavolo-2026'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['token'])

    def test_wrong_password_and_duplicates(self):
        self.register()
        res = self.client.post('/auth/login/', {'email': 'coach@example.com', 'password': 'sbagliata'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.register().status_code, 400)
        self.assertEqual(self.register('other@example.com', '1234').status_code, 400)  # weak password

    def test_api_needs_login(self):
        self.assertEqual(self.client.get('/matches/').status_code, 401)
        self.assertEqual(client_with('not-a-token').get('/matches/').status_code, 401)

    def test_logout_ends_only_this_device(self):
        tablet = self.register().data['token']
        phone = self.client.post('/auth/login/', {'email': 'coach@example.com', 'password': 'Pallavolo-2026'}, format='json').data['token']
        self.assertEqual(client_with(phone).post('/auth/logout/').status_code, 204)
        self.assertEqual(client_with(phone).get('/matches/').status_code, 401)
        self.assertEqual(client_with(tablet).get('/matches/').status_code, 200)

    def test_only_the_hash_is_stored(self):
        token = self.register().data['token']
        self.assertFalse(AuthToken.objects.filter(digest=token).exists())

    def test_unused_login_expires(self):
        token = self.register().data['token']
        AuthToken.objects.update(last_used=timezone.now() - timedelta(days=61))
        self.assertEqual(client_with(token).get('/matches/').status_code, 401)
        self.assertFalse(AuthToken.objects.exists())

    def test_login_attempts_are_limited(self):
        codes = [self.client.post('/auth/login/', {'email': 'x@example.com', 'password': 'x'}, format='json').status_code
                 for _ in range(11)]
        self.assertEqual(codes[-1], 429)


class OwnershipTests(APITestCase):
    """Each account sees and changes only its own players, teams and matches."""

    def setUp(self):
        cache.clear()
        self.anna = self.account('anna@example.com')
        self.bruno = self.account('bruno@example.com')
        self.player = self.anna.post('/players/create/', {'name': 'Ada', 'number': 7}, format='json').data['id']
        self.team = self.anna.post('/teams/create/', {'name': 'Under 16', 'playersList': [self.player]}, format='json').data['id']
        self.match = self.anna.post('/matches/create/', {'name': 'Andata', 'team_id': self.team}, format='json').data['id']
        self.set = self.anna.post('/sets/create/', {'match': self.match, 'number': 1, 'player_ids': [self.player]}, format='json').data['id']
        self.touch = self.anna.post('/touches/create/', {'set': self.set, 'player': self.player, 'fundamental': 'Attacco',
                                                         'outcome': '++', 'client_id': 't-1'}, format='json').data['id']

    def account(self, email):
        token = self.client.post('/auth/register/', {'email': email, 'password': 'Pallavolo-2026'}, format='json').data['token']
        return client_with(token)

    def test_lists_show_only_own_data(self):
        self.assertEqual(len(self.anna.get('/players/').data), 1)
        for url in ['/players/', '/teams/', '/matches/', '/sets/']:
            self.assertEqual(self.bruno.get(url).data, [], url)

    def test_other_accounts_get_404(self):
        urls = [f'/players/{self.player}/', f'/teams/{self.team}/', f'/matches/{self.match}/',
                f'/match_details/{self.match}/sets/', f'/match_details/{self.match}/team/',
                f'/match_details/{self.match}/kpi/', f'/match_details/{self.match}/rally_stats/',
                f'/match_details/sets/{self.set}/kpi/', f'/sets/{self.set}/touches/', f'/sets/{self.set}/events/',
                f'/sets/{self.set}/rallies/', f'/team_details/{self.team}/players/', f'/team_details/{self.team}/matches/',
                f'/player_details/{self.player}/teams/', f'/player_details/{self.player}/matches/']
        for url in urls:
            self.assertEqual(self.anna.get(url).status_code, 200, url)
            self.assertEqual(self.bruno.get(url).status_code, 404, url)

    def test_other_accounts_cannot_change_or_delete(self):
        self.assertEqual(self.bruno.put(f'/players/update/{self.player}/', {'name': 'X'}, format='json').status_code, 404)
        self.assertEqual(self.bruno.put(f'/matches/update/{self.match}/', {'results': []}, format='json').status_code, 404)
        self.assertEqual(self.bruno.put(f'/sets/update/{self.set}/', {'home_score': 25}, format='json').status_code, 404)
        for url in [f'/touches/delete/{self.touch}/', f'/sets/delete/{self.set}/', f'/matches/delete/{self.match}/',
                    f'/teams/delete/{self.team}/', f'/players/delete/{self.player}/']:
            self.assertEqual(self.bruno.delete(url).status_code, 404, url)
        self.assertTrue(Match.objects.filter(pk=self.match).exists())
        self.assertEqual(Player.objects.get(pk=self.player).name, 'Ada')

    def test_cannot_reference_objects_of_others(self):
        # Bruno's team cannot include Anna's player, and his match cannot use Anna's team
        self.assertEqual(self.bruno.post('/teams/create/', {'name': 'T', 'playersList': [self.player]}, format='json').status_code, 400)
        self.assertEqual(self.bruno.post('/matches/create/', {'name': 'M', 'team_id': self.team}, format='json').status_code, 400)
        self.assertEqual(self.bruno.post('/sets/create/', {'match': self.match, 'number': 2}, format='json').status_code, 400)
        for url, body in [('/touches/create/', {'set': self.set, 'player': self.player, 'fundamental': 'Muro', 'outcome': '+', 'client_id': 't-2'}),
                          ('/events/create/', {'set': self.set, 'event_type': 'TIME OUT', 'client_id': 'e-1'}),
                          ('/rallies/create/', {'set': self.set, 'number': 1, 'serving': 'home', 'rotation': 0, 'winner': 'home',
                                                'home_score': 1, 'guest_score': 0, 'client_id': 'r-1'})]:
            self.assertEqual(self.bruno.post(url, body, format='json').status_code, 400, url)

    def test_retry_does_not_return_data_of_others(self):
        # Same client id as Anna's touch: Bruno gets a validation error, not Anna's touch
        res = self.bruno.post('/touches/create/', {'set': self.set, 'player': self.player, 'fundamental': 'Attacco',
                                                   'outcome': '++', 'client_id': 't-1'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertNotIn('id', res.data)

    def test_assign_orphans(self):
        Player.objects.create(name='Vecchio')
        Team.objects.create(name='Vecchia')
        call_command('assign_orphans', 'bruno@example.com', stdout=StringIO())
        self.assertEqual([p['name'] for p in self.bruno.get('/players/').data], ['Vecchio'])
        self.assertEqual(len(self.bruno.get('/teams/').data), 1)


class OfflineSyncTests(APITestCase):
    """Data recorded offline is sent again later: every create can be repeated safely."""

    def setUp(self):
        cache.clear()
        token = self.client.post('/auth/register/', {'email': 'scout@example.com', 'password': 'Pallavolo-2026'}, format='json').data['token']
        self.api = client_with(token)
        self.player = self.api.post('/players/create/', {'name': 'Ada', 'number': 7}, format='json').data['id']
        self.team = self.api.post('/teams/create/', {'name': 'U16', 'playersList': [self.player]}, format='json').data['id']

    def test_match_and_set_created_once(self):
        body = {'name': 'Andata', 'team_id': self.team, 'client_id': 'm-1'}
        first = self.api.post('/matches/create/', body, format='json').data
        again = self.api.post('/matches/create/', body, format='json').data
        self.assertEqual(first['id'], again['id'])
        self.assertEqual(Match.objects.count(), 1)
        set_body = {'match': first['id'], 'number': 1, 'player_ids': [self.player], 'client_id': 's-1'}
        res1 = self.api.post('/sets/create/', set_body, format='json')
        res2 = self.api.post('/sets/create/', set_body, format='json')
        self.assertEqual((res1.status_code, res2.status_code), (201, 200))
        self.assertEqual(res1.data['id'], res2.data['id'])

    def test_set_retry_after_match_end_returns_the_set(self):
        match = self.api.post('/matches/create/', {'name': 'A', 'team_id': self.team}, format='json').data['id']
        body = {'match': match, 'number': 1, 'client_id': 's-2'}
        created = self.api.post('/sets/create/', body, format='json').data
        self.api.put(f'/matches/update/{match}/', {'results': [{'home_score': 25, 'guest_score': 20}], 'live_state': None}, format='json')
        self.assertEqual(self.api.post('/sets/create/', body, format='json').data['id'], created['id'])
        self.assertEqual(self.api.post('/sets/create/', {'match': match, 'number': 2, 'client_id': 's-3'}, format='json').status_code, 409)

    def test_delete_touch_by_client_id(self):
        match = self.api.post('/matches/create/', {'name': 'A', 'team_id': self.team}, format='json').data['id']
        set_id = self.api.post('/sets/create/', {'match': match, 'number': 1}, format='json').data['id']
        self.api.post('/touches/create/', {'set': set_id, 'player': self.player, 'fundamental': 'Muro', 'outcome': '+', 'client_id': 't-9'}, format='json')
        self.assertEqual(self.api.delete('/touches/delete/client/t-9/').status_code, 204)
        self.assertEqual(self.api.delete('/touches/delete/client/t-9/').status_code, 404)
        other = client_with(self.client.post('/auth/register/', {'email': 'x@example.com', 'password': 'Pallavolo-2026'}, format='json').data['token'])
        self.api.post('/touches/create/', {'set': set_id, 'player': self.player, 'fundamental': 'Muro', 'outcome': '+', 'client_id': 't-10'}, format='json')
        self.assertEqual(other.delete('/touches/delete/client/t-10/').status_code, 404)

    def test_live_state_resend_is_accepted(self):
        # A save whose answer was lost is sent again with the same writer: not a conflict
        match = self.api.post('/matches/create/', {'name': 'A', 'team_id': self.team}, format='json').data['id']
        state = {'v': 1, 'writer': 'page-1', 'baseRev': 0}
        self.assertEqual(self.api.put(f'/matches/update/{match}/', {'live_state': state}, format='json').data['live_state']['rev'], 1)
        self.assertEqual(self.api.put(f'/matches/update/{match}/', {'live_state': state}, format='json').status_code, 200)
        other = {'v': 1, 'writer': 'page-2', 'baseRev': 0}
        self.assertEqual(self.api.put(f'/matches/update/{match}/', {'live_state': other}, format='json').status_code, 409)


class PointReasonTests(APITestCase):
    """How each point was won: our winners, their errors, their winners, our errors."""

    def setUp(self):
        cache.clear()
        token = self.client.post('/auth/register/', {'email': 'coach2@example.com', 'password': 'Pallavolo-2026'}, format='json').data['token']
        self.api = client_with(token)
        team = self.api.post('/teams/create/', {'name': 'U18', 'playersList': []}, format='json').data['id']
        self.match = self.api.post('/matches/create/', {'name': 'A', 'team_id': team}, format='json').data['id']
        self.set = self.api.post('/sets/create/', {'match': self.match, 'number': 1}, format='json').data['id']
        self.n = 0

    def rally(self, winner, reason='', cause=''):
        self.n += 1
        return self.api.post('/rallies/create/', {'set': self.set, 'number': self.n, 'serving': 'home', 'rotation': 0, 'winner': winner,
                                                  'home_score': 0, 'guest_score': 0, 'cause': cause, 'reason': reason, 'client_id': f'r-{self.n}'}, format='json')

    def test_points_by_reason(self):
        self.rally('home', 'attack')
        self.rally('home', 'serve')
        self.rally('home', 'opp_serve_error')
        self.rally('home')                      # a "+" without a reason
        self.rally('guests', 'opp_attack')
        self.rally('guests', 'reception_error')
        self.rally('guests', 'penalty')
        points = self.api.get(f'/match_details/sets/{self.set}/rally_stats/').data['points']
        self.assertEqual(points['home']['total'], 4)
        self.assertEqual(points['home']['reasons']['attack'], 1)
        self.assertEqual(points['home']['gifted'], 1)
        self.assertEqual(points['home']['unspecified'], 1)
        self.assertEqual(points['guests']['gifted'], 2)
        self.assertEqual(points['guests']['reasons']['opp_attack'], 1)
        match_points = self.api.get(f'/match_details/{self.match}/rally_stats/').data['points']
        self.assertEqual(match_points['guests']['total'], 3)

    def test_empty_set_has_zero_points(self):
        points = self.api.get(f'/match_details/sets/{self.set}/rally_stats/').data['points']
        self.assertEqual((points['home']['total'], points['guests']['unspecified']), (0, 0))

    def test_reason_chosen_after_the_point(self):
        self.rally('guests')
        res = self.api.patch('/rallies/update/r-1/', {'reason': 'opp_block', 'cause': 'Muro avversario'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['reason'], 'opp_block')
        self.assertEqual(self.api.patch('/rallies/update/nope/', {'reason': 'opp_block'}, format='json').status_code, 404)
        other = client_with(self.client.post('/auth/register/', {'email': 'y@example.com', 'password': 'Pallavolo-2026'}, format='json').data['token'])
        self.assertEqual(other.patch('/rallies/update/r-1/', {'reason': 'opp_ace'}, format='json').status_code, 404)

    def test_old_rallies_get_a_reason(self):
        from importlib import import_module
        reason_from_cause = import_module('MatchVisionApp.migrations.0010_rally_reason').reason_from_cause
        class R:
            def __init__(self, cause, winner): self.cause, self.winner = cause, winner
        self.assertEqual(reason_from_cause(R('Attacco ++', 'home')), 'attack')
        self.assertEqual(reason_from_cause(R('Ricezione — —', 'guests')), 'reception_error')
        self.assertEqual(reason_from_cause(R('Cartellino rosso OSPITI', 'home')), 'opp_penalty')
        self.assertEqual(reason_from_cause(R('', 'home')), '')
