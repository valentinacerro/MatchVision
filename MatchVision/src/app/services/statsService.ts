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

// A serve or an attack with its DataVolley zones (see the Touch model on the server)
export interface TouchMapEntry {
    player_id: number | null
    player__number: number | null
    fundamental: string
    outcome: string
    start_zone: number | null
    end_zone: number | null
    end_x: number | null
    end_y: number | null
}

// A match in a season or in a player's history
export interface MatchInfo { id: number; name: string; timestamp: string; team_id: number; team_name: string; sets_won: [number, number] }

export interface SeasonStats {
    matches: MatchInfo[]
    kpi: KpiRow[]
    rallies: RallyStats
    map: TouchMapEntry[]
    // one per match, oldest first: the team rows of the KPI table and side-out / break-point
    trend: (MatchInfo & { team_rows: KpiRow[]; sideout: number | null; breakpoint: number | null })[]
}

export interface PlayerHistoryEntry { match: MatchInfo; rows: KpiRow[] }

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

    // filter: team id, from / to as YYYY-MM-DD (all optional)
    getSeasonStats(filter: { team?: number | null; from?: string; to?: string }): Observable<SeasonStats> {
        const params: Record<string, string> = {}
        if (filter.team) params['team'] = String(filter.team)
        if (filter.from) params['from'] = filter.from
        if (filter.to) params['to'] = filter.to
        return this.http.get<SeasonStats>(`${this.apiUrl}/season/stats/`, { params })
    }

    getPlayerHistory(playerId: number): Observable<PlayerHistoryEntry[]> {
        return this.http.get<PlayerHistoryEntry[]>(`${this.apiUrl}/player_details/${playerId}/history/`)
    }

    getMatchTouchMap(matchId: number): Observable<TouchMapEntry[]> {
        return this.http.get<TouchMapEntry[]>(`${this.apiUrl}/match_details/${matchId}/touch_map/`)
    }

    getSetTouchMap(setId: number): Observable<TouchMapEntry[]> {
        return this.http.get<TouchMapEntry[]>(`${this.apiUrl}/match_details/sets/${setId}/touch_map/`)
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
