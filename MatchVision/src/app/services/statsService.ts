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

}
