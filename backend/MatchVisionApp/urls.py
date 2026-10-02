from django.urls import path
from . import views

urlpatterns = [
    # Account
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),

    # Players
    path('players/', views.getPlayers),
    path('players/<int:pk>/', views.getPlayer),
    path('players/create/', views.createPlayer),
    path('players/update/<int:pk>/', views.updatePlayer),
    path('players/delete/<int:pk>/', views.deletePlayer),

    # Teams
    path('teams/', views.getTeams),
    path('teams/<int:pk>/', views.getTeam),
    path('teams/create/', views.createTeam),
    path('teams/delete/<int:pk>/', views.deleteTeam),

    # Matches
    path('matches/', views.getMatches),
    path('matches/<int:pk>/', views.getMatch),
    path('matches/create/', views.createMatch),
    path('matches/update/<int:pk>/', views.updateMatch),
    path('matches/delete/<int:pk>/', views.deleteMatch),

    # Sets
    path('sets/', views.getSets),
    path('sets/create/', views.createSet),
    path('sets/update/<int:pk>/', views.updateSet),
    path('sets/delete/<int:pk>/', views.deleteSet),
    path('sets/<int:pk>/touches/', views.getSetTouches),

    # Events
    # path('events/', views.getEvents),
    path('events/create/', views.createEvent),
    path('sets/<int:pk>/events/', views.getSetEvents),

    # Touches
    path('touches/player/<int:player_id>/match/<int:match_id>/', views.getTouchesByPlayerMatch),
    path('touches/player/<int:player_id>/match/<int:match_id>/set/<int:set_id>/', views.getTouchesByPlayerMatchSet),
    path('touches/create/', views.createTouch),
    path('touches/delete/<int:pk>/', views.deleteTouch),
    path('touches/delete/client/<str:client_id>/', views.deleteTouchByClient),
    path('touches/update/client/<str:client_id>/', views.updateTouchByClient),

    # Details
    path('player_details/<int:pk>/matches/', views.getPlayersMatches),
    path('team_details/<int:pk>/matches/', views.getTeamMatches),
    
    path('player_details/<int:pk>/teams/', views.getPlayersTeams),
    path('team_details/<int:pk>/players/', views.getTeamPlayers),
    path('match_details/<int:pk>/team/', views.getMatchTeam),
    path('match_details/<int:pk>/sets/', views.getMatchSets),

    path('match_details/<int:pk>/stats/', views.getMatchStats),
    path('match_details/sets/<int:pk>/stats/', views.getSetsStats),
    path('match_details/sets/<int:set_id>/player/<int:player_id>/stats/', views.getSetPlayerStats),

    path('match_details/<int:pk>/touch_map/', views.getMatchTouchMap),
    path('match_details/sets/<int:pk>/touch_map/', views.getSetTouchMap),
    path('match_details/<int:pk>/kpi/', views.getMatchKpi),
    path('match_details/sets/<int:pk>/kpi/', views.getSetKpi),

    # Season and player history
    path('season/stats/', views.getSeasonStats),
    path('player_details/<int:pk>/history/', views.getPlayerHistory),

    # Rallies
    path('rallies/create/', views.createRally),
    path('rallies/delete/<str:client_id>/', views.deleteRally),
    path('rallies/update/<str:client_id>/', views.updateRally),
    path('sets/<int:pk>/rallies/', views.getSetRallies),
    path('match_details/<int:pk>/rally_stats/', views.getMatchRallyStats),
    path('match_details/sets/<int:pk>/rally_stats/', views.getSetRallyStats),

]