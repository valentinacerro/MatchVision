import { Routes } from '@angular/router'
import { LoginComponent } from './pages/login/login.component'
import { DashboardComponent } from './pages/dashboard/dashboard.component'
import { MatchesComponent } from './pages/matches/matches.component'
import { StatisticsComponent } from './pages/statistics/statistics.component'
import { PlayersComponent } from './pages/players/players.component'
import { TeamsComponent } from './pages/teams/teams.component'
import { RegisterComponent } from './pages/register/register.component'
import { GameComponent } from './pages/game/game'
import { MatchesDetailsComponent } from './pages/details/matches_details/matches_details.component'
import { TeamsDetailsComponent } from './pages/details/teams_details/teams_details.component'
import { PlayersDetailsComponent } from './pages/details/players_details/players_details.component'
import { ThanksComponent } from './pages/thanks/thanks'
import { BenchComponent } from './pages/bench/bench.component'
import { authGuard } from './services/authService'

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },

  // Everything else needs a login
  { path: '', canActivateChild: [authGuard], children: [
    { path: '', component: DashboardComponent },
    { path: 'statistics', component: StatisticsComponent },
    { path: 'game', component: GameComponent },
    // The match id in the URL lets a reload (or another device) resume the match
    { path: 'game/:matchId', component: GameComponent },
    { path: 'thanks', component: ThanksComponent },
    // Read-only live stats for the bench, on another device
    { path: 'bench/:matchId', component: BenchComponent },

    // Players
    { path: 'players', component: PlayersComponent },
    // { path: 'players/create', views.createPlayer },
    // { path: 'players/update/:id', views.updatePlayer },
    // { path: 'players/delete/:id', views.deletePlayer },

    // Teams
    { path: 'teams', component: TeamsComponent },
    // { path: 'teams/create', views.createTeam },
    // { path: 'teams/delete/:id', views.deleteTeam },

    // Matches
    { path: 'matches', component: MatchesComponent },
    // { path: 'matches/create', views.createMatch },
    // { path: 'matches/delete/:id', views.deleteMatch },

    // Sets
    // { path: 'sets', views.getSets },
    // { path: 'sets/create', views.createSet },
    // { path: 'sets/delete/:id', views.deleteSet },

    // Events
    // { path: 'events', views.getEvents },
    // { path: 'events/create', views.createEvent },

    // Touches
    // { path: 'touches', views.getTouches },
    // { path: 'touches/create', views.createTouch },

    // Details
    //    Players
    { path: 'player_details/:id', component: PlayersDetailsComponent},
    //    Matches
    { path: 'match_details/:id', component: MatchesDetailsComponent},
    //    Teams
    { path: 'team_details/:id', component: TeamsDetailsComponent},
  ]},
];
