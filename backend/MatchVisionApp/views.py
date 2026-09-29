from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.http import JsonResponse
from django.db import IntegrityError, transaction

from .models import Player, Team, Match, Set, Touch, Rally, Event
from .serializers import SetUpdateSerializer, MatchUpdateSerializer, PlayerSerializer, TeamSerializer, MatchSerializer, SetSerializer, TouchSerializer, EventSerializer, UserSerializer, RallySerializer

import pandas as pd
from .utils import create_table_match_stats, create_table_set_stats, create_table_set_player, create_kpi_table, create_rally_table

# USER
# create user
@api_view(['POST'])
def createUser(request):
    serializer = UserSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    

# PLAYER CRUD
# get all players
@api_view(['GET']) 
def getPlayers(request):
    players = Player.objects.all()
    serializer = PlayerSerializer(players, many = True)
    return Response(serializer.data)

# get specific player
@api_view(['GET'])
def getPlayer(request, pk):
    player = Player.objects.get(id=pk)
    serializer = PlayerSerializer(player)
    return Response(serializer.data)

# create player
@api_view(['POST'])
def createPlayer(request):
    serializer = PlayerSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)

# update player
@api_view(['PUT'])
def updatePlayer(request, pk):
    player = Player.objects.get(id = pk)
    serializer = PlayerSerializer(player, data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    
# delete specific player
@api_view(['DELETE'])
def deletePlayer(request, pk):
    try:
        player = Player.objects.get(id = pk)
        player.delete()
        return Response({"message": "Player deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Player.DoesNotExist:
        return Response({"error": "Player not found"}, status=status.HTTP_404_NOT_FOUND)


# TEAM CRUD
# get all teams
@api_view(['GET'])
def getTeams(request):
    teams = Team.objects.all()
    serializer = TeamSerializer(teams, many = True)
    return Response(serializer.data)

# get specific team
@api_view(['GET'])
def getTeam(request, pk):
    team = Team.objects.get(id=pk)
    serializer = TeamSerializer(team)
    return Response(serializer.data)

# create team
@api_view(['POST'])
def createTeam(request):
    serializer = TeamSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=400)

# delete specific team
@api_view(['DELETE'])
def deleteTeam(request, pk):
    try:
        team = Team.objects.get(id = pk)
        team.delete()
        return Response({"message": "Team deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Team.DoesNotExist:
        return Response({"error": "Team not found"}, status=status.HTTP_404_NOT_FOUND)



# MATCH CRUD
# get all matches
@api_view(['GET'])
def getMatches(request):
    matches = Match.objects.all()
    serializer = MatchSerializer(matches, many = True)
    return Response(serializer.data)

# get a specific match
@api_view(['GET'])
def getMatch(request, pk):
    match = Match.objects.get(id = pk)
    serializer = MatchSerializer(match)
    return Response(serializer.data)

# create new match
@api_view(['POST'])
def createMatch(request):
    serializer = MatchSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)

# update match
@api_view(['PUT'])
def updateMatch(request, pk):
    with transaction.atomic():
        # Locked row: two devices saving at the same time are handled one after the other
        match = Match.objects.select_for_update().get(pk = pk)
        data = dict(request.data)
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
        match = Match.objects.get(id = pk)
        match.delete()
        return Response({"message": "Match deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Match.DoesNotExist:
        return Response({"error": "Match not found"}, status=status.HTTP_404_NOT_FOUND)
    


# SET CRUD
# get all sets
@api_view(['GET'])
def getSets(request):
    sets = Set.objects.all()
    serializer = MatchSerializer(sets, many = True)
    return Response(serializer.data)

# create new set
@api_view(['POST'])
def createSet(request):
    match = Match.objects.filter(pk = request.data.get('match')).first()
    if match and match.results:
        return Response({"error": "Partita terminata"}, status=status.HTTP_409_CONFLICT)
    serializer = SetSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# update set
@api_view(['PUT'])
def updateSet(request, pk):
    set = Set.objects.get(pk = pk)
    serializer = SetUpdateSerializer(set, data = request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# delete specific set
@api_view(['DELETE'])
def deleteSet(request, pk):
    try:
        set = Set.objects.get(id = pk)
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
    existing = Event.objects.filter(client_id=client_id).first() if client_id else None
    if existing:
        return Response(EventSerializer(existing).data, status=status.HTTP_200_OK)
    serializer = EventSerializer(data = request.data)
    if serializer.is_valid():
        serializer.save()
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
    if client_id:
        existing = Touch.objects.filter(client_id=client_id).first()
        if existing:
            return Response(TouchSerializer(existing).data, status=status.HTTP_200_OK)
    # No new touches in a finished match
    target = Set.objects.select_related('match').filter(pk = request.data.get('set')).first()
    if target and target.match.results:
        return Response({"error": "Partita terminata"}, status=status.HTTP_409_CONFLICT)
    serializer = TouchSerializer(data = request.data)
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            # The same client_id arrived twice at the same time: the other request saved it
            cid = serializer.validated_data.get('client_id')
            existing = Touch.objects.filter(client_id=cid).first() if cid else None
            if not existing:
                return Response({"error": "Tocco non valido"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(TouchSerializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
# get touches by player and match
@api_view(['GET'])
def getTouchesByPlayerMatch(request, player_id, match_id):
    touches = Touch.objects.filter(player_id=player_id, match_id=match_id)
    serializer = TouchSerializer(touches, many=True)
    return Response(serializer.data)
    
# get touches by player and match and set
@api_view(['GET'])
def getTouchesByPlayerMatchSet(request, player_id, match_id, set_id):
    touches = Touch.objects.filter(player_id=player_id, match_id=match_id, set_id=set_id)
    serializer = TouchSerializer(touches, many=True)
    return Response(serializer.data)

@api_view(['DELETE'])
def deleteTouch(request, pk):
    try:
        touch = Touch.objects.get(id=pk)
        touch.delete()
        return Response({"message": "Touch deleted successfully"}, status=status.HTTP_204_NO_CONTENT)
    except Touch.DoesNotExist:
        return Response({"error": "Touch not found"}, status=status.HTTP_404_NOT_FOUND)



# Details
# teams with player
@api_view(['GET'])
def getPlayersTeams(request, pk):
    player = Player.objects.get(pk = pk)
    teams_direct = Team.objects.filter(playersList=player)
    teams_non_direct = Team.objects.filter(matches__sets__players=player)
    teams = (teams_direct | teams_non_direct).distinct()
    return Response(TeamSerializer(teams, many=True).data)

# matches with player
@api_view(['GET'])
def getPlayersMatches(request, pk):
    player = Player.objects.get(pk=pk)
    matches = Match.objects.filter(sets__players=player).distinct()
    return Response(MatchSerializer(matches, many=True).data)

# team of the match
@api_view(['GET'])
def getMatchTeam(request, pk):
    match = Match.objects.get(pk=pk)
    return Response(TeamSerializer(match.team).data)

# sets of the match
@api_view(['GET'])
def getMatchSets(request, pk):
    match = Match.objects.get(pk=pk)
    sets = Set.objects.filter(match=match).order_by("number")
    return Response(SetSerializer(sets, many=True).data)

# players of the team
@api_view(['GET'])
def getTeamPlayers(request, pk):
    team = Team.objects.get(pk=pk)
    players = team.playersList.all()
    return Response(PlayerSerializer(players, many=True).data)

# matches of a team
@api_view(['GET'])
def getTeamMatches(request, pk):
    team = Team.objects.get(pk=pk)
    matches = Match.objects.filter(team=team).distinct()    
    return Response(MatchSerializer(matches, many=True).data)


@api_view(['GET'])
def getMatchStats(request, pk):
    df_final = create_table_match_stats(pk)
    data = df_final.reset_index().to_dict(orient='records')
    return JsonResponse(data, safe=False)

@api_view(['GET'])
def getSetsStats(request, pk):
    df_final = create_table_set_stats(pk)
    data = df_final.reset_index().to_dict(orient='records')
    return JsonResponse(data, safe=False)

@api_view(['GET'])
def getSetPlayerStats(request, set_id, player_id):
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
    return Response(create_kpi_table(Touch.objects.filter(set__match_id=pk)))

@api_view(['GET'])
def getSetKpi(request, pk):
    return Response(create_kpi_table(Touch.objects.filter(set_id=pk)))


# Touches of a set in the order they were recorded (to resume a match)
@api_view(['GET'])
def getSetTouches(request, pk):
    touches = Touch.objects.filter(set_id=pk).order_by('id')
    return Response(TouchSerializer(touches, many=True).data)


# RALLIES: one per point, sent by the game screen
@api_view(['POST'])
def createRally(request):
    client_id = request.data.get('client_id')
    # A retry of a rally already saved returns it instead of creating a duplicate
    existing = Rally.objects.filter(client_id=client_id).first() if client_id else None
    if existing:
        return Response(RallySerializer(existing).data, status=status.HTTP_200_OK)
    target = Set.objects.select_related('match').filter(pk=request.data.get('set')).first()
    if target and target.match.results:
        return Response({"error": "Partita terminata"}, status=status.HTTP_409_CONFLICT)
    serializer = RallySerializer(data=request.data)
    if serializer.is_valid():
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError:
            existing = Rally.objects.filter(client_id=serializer.validated_data.get('client_id')).first()
            if not existing:
                return Response({"error": "Rally non valido"}, status=status.HTTP_400_BAD_REQUEST)
            return Response(RallySerializer(existing).data, status=status.HTTP_200_OK)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# Undo of a point: the client knows the rally by its client id
@api_view(['DELETE'])
def deleteRally(request, client_id):
    deleted, _ = Rally.objects.filter(client_id=client_id).delete()
    return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
def getSetRallies(request, pk):
    return Response(RallySerializer(Rally.objects.filter(set_id=pk), many=True).data)

# Side-out / break-point statistics
@api_view(['GET'])
def getMatchRallyStats(request, pk):
    return Response(create_rally_table(Rally.objects.filter(set__match_id=pk)))

@api_view(['GET'])
def getSetRallyStats(request, pk):
    return Response(create_rally_table(Rally.objects.filter(set_id=pk)))


# Events of a set (substitutions, time-outs, cards) in the order they happened
@api_view(['GET'])
def getSetEvents(request, pk):
    return Response(EventSerializer(Event.objects.filter(set_id=pk), many=True).data)
