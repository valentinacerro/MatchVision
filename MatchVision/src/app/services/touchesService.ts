import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Touch } from '../Models/Touch';
import { API_URL } from './apiConfig';

@Injectable({
  providedIn: 'root'
})

export class TouchesService {

    private apiUrl = API_URL

    constructor(private http: HttpClient) {}

    // Touches of a set in recording order (used to resume a match)
    getSetTouches(setId: number): Observable<Touch[]> {
        return this.http.get<Touch[]>(`${this.apiUrl}/sets/${setId}/touches/`);
    }

    // writer: the page that owns the match (the server refuses writes from a page that lost it)
    createTouch(touch: Touch & { writer?: string }): Observable<Touch> {
        return this.http.post<Touch>(`${this.apiUrl}/touches/create/`, touch);
    }

    getTouchesByPlayerMatch(playerId: number, matchId: number): Observable<Touch[]> {
        return this.http.get<Touch[]>(`${this.apiUrl}/touches/player/${playerId}/match/${matchId}/`);
    }

    getTouchesByPlayerMatchSet(playerId: number, matchId: number, setId: number): Observable<Touch[]> {
        return this.http.get<Touch[]>(`${this.apiUrl}/touches/player/${playerId}/match/${matchId}/set/${setId}/`);
    }

    deleteTouch(id: number | undefined): Observable<any> {
        return this.http.delete(`${this.apiUrl}/touches/delete/${id}/`);
    }
}
