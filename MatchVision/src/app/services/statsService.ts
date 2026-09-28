import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { Player } from '../Models/Player'
import { API_URL } from './apiConfig'

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

}
