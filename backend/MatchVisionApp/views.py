from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework import status
from django.contrib.auth import authenticate
from django.http import JsonResponse
from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404

from .auth import issue_token
from .models import Player, Team, Match, Set, Touch, Rally, Event
from .serializers import RallyReasonSerializer, SetUpdateSerializer, MatchUpdateSerializer, PlayerSerializer, TeamSerializer, MatchSerializer, SetSerializer, TouchSerializer, EventSerializer, AccountSerializer, RegisterSerializer, RallySerializer

import pandas as pd
from .utils import create_table_match_stats, create_table_set_stats, create_table_set_player, create_kpi_table, create_rally_table

def refused_write(match, request):
    """
    Reason to refuse a write from the game screen, or None:
    - the match is finished, or
    - another page took control of it (the live state was last saved by a different writer).
    """
    if match is None:
        return None
    if match.results:
        return "Partita terminata"
    return foreign_writer(match, request)


def foreign_writer(match, request):
    """The match is controlled by another page (writer in the body, or ?writer= for DELETE)."""
    writer = request.data.get('writer') or request.query_params.get('writer')
    owner = (match.live_state or {}).get('writer')
    if writer and owner and writer != owner:
        return "Partita aperta su un altro dispositivo"
    return None


# Every user sees and changes only their own data: objects of other users answer 404
def own_match(request, pk):
    return get_object_or_404(Match, pk=pk, user=request.user)

def own_set(request, pk):
    return get_object_or_404(Set.objects.select_related('match'), pk=pk, match__user=request.user)

def owned(queryset, pk):
    """The object with this id in the queryset, or None (also for a missing or malformed id)."""
    try:
        return queryset.filter(pk=int(pk)).first()
    except (TypeError, ValueError):
        return None

def own_sets(request):
    return Set.objects.select_related('match').filter(match__user=request.user)


# ACCOUNT
class AuthThrottle(AnonRateThrottle):
    """Login and register: a few attempts per minute from the same address"""
    scope = 'auth'

def session(user, status_code=status.HTTP_200_OK):
    return Response({"token": issue_token(user), "user": AccountSerializer(user).data}, status=status_code)

@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def register(request):
    serializer = RegisterSerializer(data = request.data)
    if serializer.is_valid():
        return session(serializer.save(), status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([AuthThrottle])
def login(request):
    email = str(request.data.get('email') or '').strip().lower()
    user = authenticate(request, username=email, password=str(request.data.get('password') or ''))
    if user is None:
        return Response({"error": "Email o password errati"}, status=status.HTTP_400_BAD_REQUEST)
    return session(user)

# Ends the session of this device only
@api_view(['POST'])
def logout(request):
    request.auth.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)

@api_view(['GET'])
def me(request):
    return Response(AccountSerializer(request.user).data)


# PLAYER CRUD
# get all players
@api_view(['GET']) 
def getPlayers(request):
    players = Player.objects.filter(user=request.user)
    serializer = PlayerSerializer(players, many = True)
    return Response(serializer.data)

# get specific player
@api_view(['GET'])
def getPlayer(request, pk):
    player = get_object_or_404(Player, pk=pk, user=request.user)
    serializer = PlayerSerializer(player)
    return Response(serializer.data)

# create player
@api_view(['POST'])
def createPlayer(request):
    serializer = PlayerSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save(user=request.user)
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# update player
@api_view(['PUT'])
def updatePlayer(request, pk):
    player = get_object_or_404(Player, pk=pk, user=request.user)
    serializer = PlayerSerializer(player, data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# delete specific player
@api_view(['DELETE'])
def deletePlayer(request, pk):
    try:
        player = Player.objects.get(id = pk, user=request.user)
        player.delete()
        return Response({"message": "Player deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Player.DoesNotExist:
        return Response({"error": "Player not found"}, status=status.HTTP_404_NOT_FOUND)


# TEAM CRUD
# get all teams
@api_view(['GET'])
def getTeams(request):
    teams = Team.objects.filter(user=request.user)
    serializer = TeamSerializer(teams, many = True)
    return Response(serializer.data)

# get specific team
@api_view(['GET'])
def getTeam(request, pk):
    team = get_object_or_404(Team, pk=pk, user=request.user)
    serializer = TeamSerializer(team)
    return Response(serializer.data)

# create team
@api_view(['POST'])
def createTeam(request):
    serializer = TeamSerializer(data = request.data, context={'request': request})
    if serializer.is_valid():
        serializer.save(user=request.user)
        return Response(serializer.data)
    return Response(serializer.errors, status=400)

# delete specific team
@api_view(['DELETE'])
def deleteTeam(request, pk):
    try:
        team = Team.objects.get(id = pk, user=request.user)
        team.delete()
        return Response({"message": "Team deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Team.DoesNotExist:
        return Response({"error": "Team not found"}, status=status.HTTP_404_NOT_FOUND)



# MATCH CRUD
# get all matches
@api_view(['GET'])
def getMatches(request):
    matches = Match.objects.filter(user=request.user)
    serializer = MatchSerializer(matches, many = True)
    return Response(serializer.data)

# get a specific match
@api_view(['GET'])
def getMatch(request, pk):
    match = own_match(request, pk)
    serializer = MatchSerializer(match)
    return Response(serializer.data)

# create new match
@api_view(['POST'])
def createMatch(request):
    # A retry (e.g. a match created offline, sent when the connection is back) returns the match already saved
    matches = Match.objects.filter(user=request.user)
    client_id = request.data.get('client_id')
    existing = matches.filter(client_id=client_id).first() if client_id else None
    if existing:
        return Response(MatchSerializer(existing).data)
    serializer = MatchSerializer(data = request.data, context={'request': request})
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save(user=request.user)
        except IntegrityError:
            existing = matches.filter(client_id=serializer.validated_data.get('client_id')).first()
            if not existing:
                return Response({"error": "Partita non valida"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(MatchSerializer(existing).data)
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# update match
@api_view(['PUT'])
def updateMatch(request, pk):
    with transaction.atomic():
        # Locked row: two devices saving at the same time are handled one after the other
        match = get_object_or_404(Match.objects.select_for_update(), pk = pk, user = request.user)
        data = dict(request.data)
        data.pop('writer', None)
        # Ending the match (results) is allowed only to the page that controls it
        if 'results' in data and foreign_writer(match, request):
            return Response({"error": foreign_writer(match, request)}, status=status.HTTP_409_CONFLICT)
        incoming = data.get('live_state')
        if incoming is not None:
            # A finished match cannot be reopened (e.g. by a save that arrives after FINE MATCH)
            if match.results and 'results' not in data:
                return Response({"error": "Partita terminata"}, status=status.HTTP_409_CONFLICT)
            if isinstance(incoming, dict):
                # Compare-and-swap on a revision owned by the server: the client sends the revision
                # it last got back (baseRev) and its page id (writer). A device that did not see the
                # latest save of another device is refused; the server assigns the next revision.
                stored = match.live_state or {}
                stored_rev = stored.get('rev', 0)
                same_writer = bool(incoming.get('writer')) and incoming.get('writer') == stored.get('writer')
                if incoming.get('baseRev', 0) != stored_rev and not same_writer:
                    return Response({"error": "Partita aggiornata da un altro dispositivo", "rev": stored_rev}, status=status.HTTP_409_CONFLICT)
                data['live_state'] = {**incoming, 'rev': stored_rev + 1}
        # partial: the live state is saved on its own, without resending the results
        serializer = MatchUpdateSerializer(match, data = data, partial = True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# delete specific match
@api_view(['DELETE'])
def deleteMatch(request, pk):
    try:
        match = Match.objects.get(id = pk, user=request.user)
        match.delete()
        return Response({"message": "Match deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Match.DoesNotExist:
        return Response({"error": "Match not found"}, status=status.HTTP_404_NOT_FOUND)
    


# SET CRUD
# get all sets
@api_view(['GET'])
def getSets(request):
    sets = own_sets(request)
    serializer = SetSerializer(sets, many = True)
    return Response(serializer.data)

# create new set
@api_view(['POST'])
def createSet(request):
    # A retry of a set already saved returns it instead of creating a second one
    client_id = request.data.get('client_id')
    existing = own_sets(request).filter(client_id=client_id).first() if client_id else None
    if existing:
        return Response(SetSerializer(existing).data, status=status.HTTP_200_OK)
    match = owned(Match.objects.filter(user=request.user), request.data.get('match'))
    reason = refused_write(match, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    serializer = SetSerializer(data = request.data, context={'request': request})
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            existing = own_sets(request).filter(client_id=serializer.validated_data.get('client_id')).first()
            if not existing:
                return Response({"error": "Set non valido"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(SetSerializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# update set
@api_view(['PUT'])
def updateSet(request, pk):
    set = own_set(request, pk)
    reason = refused_write(set.match, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    serializer = SetUpdateSerializer(set, data = request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# delete specific set
@api_view(['DELETE'])
def deleteSet(request, pk):
    try:
        set = own_sets(request).get(id = pk)
        reason = refused_write(set.match, request)
        if reason:
            return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
        set.delete()
        return Response({"message": "Set deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Set.DoesNotExist:
        return Response({"error": "Set not found"}, status=status.HTTP_404_NOT_FOUND)



# EVENT CRUD
# create new event
@api_view(['POST'])
def createEvent(request):
    # A retry returns the event already saved (same client id)
    client_id = request.data.get('client_id')
    events = Event.objects.filter(set__match__user=request.user)
    existing = events.filter(client_id=client_id).first() if client_id else None
    if existing:
        return Response(EventSerializer(existing).data, status=status.HTTP_200_OK)
    target = owned(own_sets(request), request.data.get('set'))
    reason = refused_write(target.match if target else None, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    serializer = EventSerializer(data = request.data, context={'request': request})
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            existing = events.filter(client_id=serializer.validated_data.get('client_id')).first()
            if not existing:
                return Response({"error": "Evento non valido"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(EventSerializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# delete specific event
    



# TOUCH CRUD
# get all touches
# @api_view(['GET'])
# def getTouches(request):
#     touches = Touch.objects.all()
#     serializer = TouchSerializer(touches, many = True)
#     return Response(serializer.data)

# create new touch
@api_view(['POST'])
def createTouch(request):
    # A retry of a touch already saved returns it instead of creating a duplicate
    client_id = request.data.get('client_id')
    touches = Touch.objects.filter(set__match__user=request.user)
    if client_id:
        existing = touches.filter(client_id=client_id).first()
        if existing:
            return Response(TouchSerializer(existing).data, status=status.HTTP_200_OK)
    # No new touches in a finished match, or from a page that lost control of it
    target = owned(own_sets(request), request.data.get('set'))
    reason = refused_write(target.match if target else None, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    serializer = TouchSerializer(data = request.data, context={'request': request})
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            # The same client_id arrived twice at the same time: the other request saved it
            cid = serializer.validated_data.get('client_id')
            existing = touches.filter(client_id=cid).first() if cid else None
            if not existing:
                return Response({"error": "Tocco non valido"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(TouchSerializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# get touches by player and match
@api_view(['GET'])
def getTouchesByPlayerMatch(request, player_id, match_id):
    touches = Touch.objects.filter(player_id=player_id, set__match_id=match_id, set__match__user=request.user)
    serializer = TouchSerializer(touches, many=True)
    return Response(serializer.data)
    
# get touches by player and match and set
@api_view(['GET'])
def getTouchesByPlayerMatchSet(request, player_id, match_id, set_id):
    touches = Touch.objects.filter(player_id=player_id, set__match_id=match_id, set_id=set_id, set__match__user=request.user)
    serializer = TouchSerializer(touches, many=True)
    return Response(serializer.data)

# By client id: a touch recorded offline is undone before the device ever learns its server id
@api_view(['DELETE'])
def deleteTouchByClient(request, client_id):
    touch = Touch.objects.select_related('set__match').filter(client_id=client_id, set__match__user=request.user).first()
    if touch is None:
        return Response({"error": "Touch not found"}, status=status.HTTP_404_NOT_FOUND)
    reason = refused_write(touch.set.match, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    touch.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)

@api_view(['DELETE'])
def deleteTouch(request, pk):
    try:
        touch = Touch.objects.select_related('set__match').get(id=pk, set__match__user=request.user)
        reason = refused_write(touch.set.match, request)
        if reason:
            return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
        touch.delete()
        return Response({"message": "Touch deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Touch.DoesNotExist:
        return Response({"error": "Touch not found"}, status=status.HTTP_404_NOT_FOUND)



# Details
# teams with player
@api_view(['GET'])
def getPlayersTeams(request, pk):
    player = get_object_or_404(Player, pk=pk, user=request.user)
    teams_direct = Team.objects.filter(playersList=player, user=request.user)
    teams_non_direct = Team.objects.filter(matches__sets__players=player, user=request.user)
    teams = (teams_direct | teams_non_direct).distinct()
    return Response(TeamSerializer(teams, many=True).data)

# matches with player
@api_view(['GET'])
def getPlayersMatches(request, pk):
    player = get_object_or_404(Player, pk=pk, user=request.user)
    matches = Match.objects.filter(sets__players=player, user=request.user).distinct()
    return Response(MatchSerializer(matches, many=True).data)

# team of the match
@api_view(['GET'])
def getMatchTeam(request, pk):
    match = own_match(request, pk)
    return Response(TeamSerializer(match.team).data)

# sets of the match
@api_view(['GET'])
def getMatchSets(request, pk):
    match = own_match(request, pk)
    sets = Set.objects.filter(match=match).order_by("number")
    return Response(SetSerializer(sets, many=True).data)

# players of the team
@api_view(['GET'])
def getTeamPlayers(request, pk):
    team = get_object_or_404(Team, pk=pk, user=request.user)
    players = team.playersList.all()
    return Response(PlayerSerializer(players, many=True).data)

# matches of a team
@api_view(['GET'])
def getTeamMatches(request, pk):
    team = get_object_or_404(Team, pk=pk, user=request.user)
    matches = Match.objects.filter(team=team).distinct()
    return Response(MatchSerializer(matches, many=True).data)


@api_view(['GET'])
def getMatchStats(request, pk):
    own_match(request, pk)
    df_final = create_table_match_stats(pk)
    data = df_final.reset_index().to_dict(orient='records')
    return JsonResponse(data, safe=False)

@api_view(['GET'])
def getSetsStats(request, pk):
    own_set(request, pk)
    df_final = create_table_set_stats(pk)
    data = df_final.reset_index().to_dict(orient='records')
    return JsonResponse(data, safe=False)

@api_view(['GET'])
def getSetPlayerStats(request, set_id, player_id):
    own_set(request, set_id)
    df_final = create_table_set_player(set_id, player_id)
    if df_final.empty:
        return JsonResponse([], safe=False)
    data = df_final.to_dict(orient='records')
    return JsonResponse(data, safe=False)



# @api_view(['GET'])
# def getMultipleSetsStats(request):
#     """
#     Returns an array of DataFrames, one for each set ID provided in the query parameters.
#     Example URL: /api/sets/stats/?ids=1&ids=2&ids=3
#     """
#     set_ids_str = request.GET.getlist('ids')
#     set_ids = [int(id) for id in set_ids_str]
    
#     # Get the list of DataFrames
#     df_list = create_table_set_stats(set_ids)
    
#     # Convert each DataFrame to a dictionary
#     data_list = [df.reset_index().to_dict(orient='records') for df in df_list]
    
#     # Return the list of dictionaries as a JSON response
#     return JsonResponse(data_list, safe=False)


# KPI (numbers) per player and fundamental
@api_view(['GET'])
def getMatchKpi(request, pk):
    own_match(request, pk)
    return Response(create_kpi_table(Touch.objects.filter(set__match_id=pk)))

@api_view(['GET'])
def getSetKpi(request, pk):
    own_set(request, pk)
    return Response(create_kpi_table(Touch.objects.filter(set_id=pk)))


# Touches of a set in the order they were recorded (to resume a match)
@api_view(['GET'])
def getSetTouches(request, pk):
    own_set(request, pk)
    touches = Touch.objects.filter(set_id=pk).order_by('id')
    return Response(TouchSerializer(touches, many=True).data)


# RALLIES: one per point, sent by the game screen
@api_view(['POST'])
def createRally(request):
    client_id = request.data.get('client_id')
    # A retry of a rally already saved returns it instead of creating a duplicate
    rallies = Rally.objects.filter(set__match__user=request.user)
    existing = rallies.filter(client_id=client_id).first() if client_id else None
    if existing:
        return Response(RallySerializer(existing).data, status=status.HTTP_200_OK)
    target = owned(own_sets(request), request.data.get('set'))
    reason = refused_write(target.match if target else None, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    serializer = RallySerializer(data=request.data, context={'request': request})
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            existing = rallies.filter(client_id=serializer.validated_data.get('client_id')).first()
            if not existing:
                return Response({"error": "Rally non valido"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(RallySerializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# Undo of a point: the client knows the rally by its client id
@api_view(['DELETE'])
def deleteRally(request, client_id):
    rally = Rally.objects.select_related('set__match').filter(client_id=client_id, set__match__user=request.user).first()
    if rally is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    reason = refused_write(rally.set.match, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    rally.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)

# Why the point was won, chosen after the rally (by client id, like the undo)
@api_view(['PATCH'])
def updateRally(request, client_id):
    rally = Rally.objects.select_related('set__match').filter(client_id=client_id, set__match__user=request.user).first()
    if rally is None:
        return Response(status=status.HTTP_404_NOT_FOUND)
    reason = refused_write(rally.set.match, request)
    if reason:
        return Response({"error": reason}, status=status.HTTP_409_CONFLICT)
    serializer = RallyReasonSerializer(rally, data=request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(RallySerializer(rally).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(['GET'])
def getSetRallies(request, pk):
    own_set(request, pk)
    return Response(RallySerializer(Rally.objects.filter(set_id=pk), many=True).data)

# Side-out / break-point statistics
@api_view(['GET'])
def getMatchRallyStats(request, pk):
    # Over a whole match the lineup may start differently in each set: group by the player in P1
    own_match(request, pk)
    return Response(create_rally_table(Rally.objects.filter(set__match_id=pk), by='p1'))

@api_view(['GET'])
def getSetRallyStats(request, pk):
    own_set(request, pk)
    return Response(create_rally_table(Rally.objects.filter(set_id=pk)))


# Events of a set (substitutions, time-outs, cards) in the order they happened
@api_view(['GET'])
def getSetEvents(request, pk):
    own_set(request, pk)
    return Response(EventSerializer(Event.objects.filter(set_id=pk), many=True).data)
