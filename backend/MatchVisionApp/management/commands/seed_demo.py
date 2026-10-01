import random
import uuid

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from MatchVisionApp.models import Event, Match, Player, Rally, Set, Team, Touch

# Lineup in positions I..VI (I serves first): setter, outside, middle, opposite, outside, middle
ROSTER = [
    ('Giulia', 'Bianchi', 1, 'Alzatore'), ('Sara', 'Conti', 4, 'Lato'), ('Marta', 'Ricci', 7, 'Centrale'),
    ('Elena', 'Greco', 9, 'Opposto'), ('Chiara', 'Romano', 11, 'Lato'), ('Laura', 'Gallo', 14, 'Centrale'),
    ('Paola', 'Costa', 5, 'Libero'), ('Anna', 'Fontana', 17, 'Lato'),
]
FINAL_SCORES = [(25, 21), (22, 25), (25, 19), (25, 23)]
ZONES = [[4, 3, 2], [7, 8, 9], [5, 6, 1]]  # DataVolley, from the net, seen by the team on that half


def point_in(zone, rnd):
    """A random point (x 0-1 from the left of the team on that half, y 0-1 from the net) inside a zone."""
    row = next(i for i, r in enumerate(ZONES) if zone in r)
    col = ZONES[row].index(zone)
    return round((col + rnd.random()) / 3, 3), round((row + rnd.random()) / 3, 3)


def attack_zone(role, position):
    front = position in (2, 3, 4)
    if front:
        return {'Lato': 4, 'Centrale': 3, 'Opposto': 2, 'Alzatore': 2}.get(role, position)
    return {'Opposto': 9, 'Lato': 8}.get(role, {1: 9, 6: 8, 5: 7}[position])


class Command(BaseCommand):
    help = "Crea per un account una partita dimostrativa completa (4 set, rally, motivi dei punti, zone)"

    def add_arguments(self, parser):
        parser.add_argument('email', help="Email dell'account")
        parser.add_argument('--seed', type=int, default=7, help="Stessa partita a ogni esecuzione con lo stesso seed")

    def handle(self, *args, email, seed, **options):
        user = get_user_model().objects.filter(username=email.strip().lower()).first()
        if user is None:
            raise CommandError(f"Nessun account con email {email}: registrati prima dall'app")
        rnd = random.Random(seed)
        with transaction.atomic():
            team = Team.objects.filter(user=user, name='Squadra demo').first()
            if team is None:
                team = Team.objects.create(user=user, name='Squadra demo')
                for name, surname, number, role in ROSTER:
                    team.playersList.add(Player.objects.create(user=user, name=name, surname=surname, number=number, role=role))
            players = {p.number: p for p in team.playersList.all()}
            missing = [n for _, _, n, _ in ROSTER if n not in players]
            if missing:
                raise CommandError(f"La Squadra demo di questo account non ha i numeri {missing}")
            lineup = [players[n] for n in (1, 4, 7, 9, 11, 14)]
            libero = players[5]
            n = Match.objects.filter(user=user, name__startswith='Partita dimostrativa').count() + 1
            match = Match.objects.create(user=user, team=team, name=f'Partita dimostrativa {n}',
                                         results=[{'home_score': h, 'guest_score': g} for h, g in FINAL_SCORES])
            counts = {'touches': 0, 'rallies': 0}
            for number, final in enumerate(FINAL_SCORES, start=1):
                self.play_set(match, number, final, lineup, libero, rnd, counts)
        self.stdout.write(self.style.SUCCESS(
            f"Creata «{match.name}» per {user.username}: {len(FINAL_SCORES)} set, {counts['rallies']} punti, {counts['touches']} tocchi"))

    def play_set(self, match, number, final, lineup, libero, rnd, counts):
        s = Set.objects.create(match=match, number=number, home_score=final[0], guest_score=final[1])
        s.players.set(lineup + [libero])
        # Who wins each point: shuffled, the set winner takes the last one (the set cannot end before)
        winner = 'home' if final[0] > final[1] else 'guests'
        points = ['home'] * (final[0] - (winner == 'home')) + ['guests'] * (final[1] - (winner == 'guests'))
        rnd.shuffle(points)
        points.append(winner)
        serving = 'home' if number % 2 == 1 else 'guests'
        rotation = 0
        score = {'home': 0, 'guests': 0}
        touches = []
        timeouts = 0

        def player_at(position):
            return lineup[(position - 1 + rotation) % 6]

        def touch(player, fundamental, outcome, start=None, end=None):
            x, y = point_in(end, rnd) if end else (None, None)
            touches.append(Touch(set=s, player=player, fundamental=fundamental, outcome=outcome, client_id=str(uuid.uuid4()),
                                 start_zone=start, end_zone=end, end_x=x, end_y=y))

        # How often each role attacks (outside hitters most, then the opposite, then the middles)
        weight = {'Lato': 3, 'Opposto': 2, 'Centrale': 1.2}

        def attacker():
            # Front-row hitters most of the time, sometimes the pipe or the opposite from the back row
            if rnd.random() < 0.12:
                back = [p for p in (1, 6, 5) if player_at(p).role in ('Lato', 'Opposto')]
                position = rnd.choice(back)
            else:
                front = [p for p in (2, 3, 4) if player_at(p).role in weight]
                position = rnd.choices(front, [weight[player_at(p).role] for p in front])[0]
            p = player_at(position)
            return p, attack_zone(p.role, position)

        for i, won in enumerate(points, start=1):
            before = {'serving': serving, 'rotation': rotation}
            reason, cause = '', ''
            if serving == 'home':
                server = player_at(1)
                if won == 'home' and rnd.random() < 0.18:
                    touch(server, 'Battuta', '++', end=rnd.choice([1, 5, 6, 6, 7]))
                    reason, cause = 'serve', 'Battuta ++'
                elif won == 'guests' and rnd.random() < 0.25:
                    touch(server, 'Battuta', '— —')
                    reason, cause = 'serve_error', 'Battuta — —'
                else:
                    touch(server, 'Battuta', rnd.choice(['+', '!', '!', '—']), end=rnd.choice([1, 5, 6, 5, 9, 7]))
            else:
                receiver = libero if rnd.random() < 0.5 else player_at(rnd.choice([5, 6, 1]))
                if won == 'guests' and rnd.random() < 0.15:
                    touch(receiver, 'Ricezione', '— —')
                    reason, cause = 'reception_error', 'Ricezione — —'
                else:
                    touch(receiver, 'Ricezione', rnd.choices(['++', '+', '!', '—'], [3, 4, 2, 1])[0])
            if not reason:
                setter = player_at(next(p for p in range(1, 7) if player_at(p).role == 'Alzatore'))
                touch(setter, 'Alzata', rnd.choices(['++', '+', '!'], [3, 5, 2])[0])
                hitter, start = attacker()
                roll = rnd.random()
                if won == 'home':
                    if roll < 0.6:
                        touch(hitter, 'Attacco', '++', start=start, end=rnd.choice([1, 5, 6, 4, 2, 8, 9, 7]))
                        reason, cause = 'attack', 'Attacco ++'
                    elif roll < 0.75:
                        touch(player_at(rnd.choice([2, 3, 4])), 'Muro', '++')
                        reason, cause = 'block', 'Muro ++'
                    else:
                        touch(hitter, 'Attacco', '+', start=start, end=rnd.choice([6, 5, 1, 8]))
                        reason = rnd.choice(['opp_attack_error', 'opp_serve_error', 'opp_fault'])
                else:
                    if roll < 0.3:
                        touch(hitter, 'Attacco', '— —', start=start)
                        reason, cause = 'attack_error', 'Attacco — —'
                    else:
                        touch(hitter, 'Attacco', rnd.choice(['+', '!', '—']), start=start, end=rnd.choice([6, 5, 1, 8, 9]))
                        if rnd.random() < 0.4:
                            touch(libero if rnd.random() < 0.6 else player_at(rnd.choice([5, 6, 1])), 'Difesa', rnd.choice(['!', '—']))
                        reason = rnd.choice(['opp_attack', 'opp_attack', 'opp_block', 'opp_ace', 'opp_point'])
            score[won] += 1
            Rally.objects.create(set=s, number=i, serving=before['serving'], rotation=before['rotation'],
                                 p1_player=player_at(1), winner=won, home_score=score['home'], guest_score=score['guests'],
                                 cause=cause, reason=reason, client_id=str(uuid.uuid4()))
            counts['rallies'] += 1
            # Side-out: we rotate; a time-out when the opponent runs three points in a row
            if won == 'home' and serving == 'guests':
                rotation = (rotation + 1) % 6
            serving = won
            if timeouts < 2 and i >= 3 and points[i - 3:i] == ['guests'] * 3:
                timeouts += 1
                Event.objects.create(set=s, event_type='TECHNICAL_TIMEOUT', team='home', home_score=score['home'],
                                     guest_score=score['guests'], client_id=str(uuid.uuid4()))
        Touch.objects.bulk_create(touches)
        counts['touches'] += len(touches)
