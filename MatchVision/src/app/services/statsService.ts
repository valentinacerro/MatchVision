import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { Player } from '../Models/Player'
import { API_URL } from './apiConfig'

// One row of the KPI table: a player (or the team) for one fundamental. Percentages 0-100.
export interface KpiRow {
    player_id: number | null
    number: number | null
    player: string
    team: boolean
    fundamental: string
    '++': number
    '+': number
    '!': number
    '—': number
    '— —': number
    tot: number
    positivita: number
    efficienza: number
    errori: number
}

export interface Share { won: number; total: number; pct: number | null }

// Points of one team by reason (codes in POINT_REASONS); gifted = from errors and penalties of the other team
export interface TeamPoints {
    total: number
    gifted: number
    unspecified: number
    reasons: Record<string, number>
}

// Side-out (points won on the opponent's serve) and break-point (on our serve), overall and per rotation
export interface RallyStats {
    total: number
    sideout: Share
    breakpoint: Share
    // rotation is null in match totals, which are grouped by the player in P1 instead
    rotations: { rotation: number | null; p1: number | null; sideout: Share; breakpoint: Share }[]
    points?: { home: TeamPoints; guests: TeamPoints }
}

@Injectable({
    providedIn: 'root'
})

export class StatsService {

    private apiUrl = API_URL

    constructor(private http: HttpClient) {}
    
    getMatchStats(matchId: number): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/match_details/${matchId}/stats/`)
    }

    getSetsStats(setId: number): Observable<any[]> {
        return this.http.get<any[]>(`${this.apiUrl}/match_details/sets/${setId}/stats/`)
    }

    getSetPlayerStats(setId: number, player: Player): Observable<any> {
        return this.http.get<any>(`${this.apiUrl}/match_details/sets/${setId}/player/${player.id}/stats/`);
    }

    getMatchKpi(matchId: number): Observable<KpiRow[]> {
        return this.http.get<KpiRow[]>(`${this.apiUrl}/match_details/${matchId}/kpi/`)
    }

    getSetKpi(setId: number): Observable<KpiRow[]> {
        return this.http.get<KpiRow[]>(`${this.apiUrl}/match_details/sets/${setId}/kpi/`)
    }

    getMatchRallyStats(matchId: number): Observable<RallyStats> {
        return this.http.get<RallyStats>(`${this.apiUrl}/match_details/${matchId}/rally_stats/`)
    }

    getSetRallyStats(setId: number): Observable<RallyStats> {
        return this.http.get<RallyStats>(`${this.apiUrl}/match_details/sets/${setId}/rally_stats/`)
    }

}
