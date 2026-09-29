import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Set } from '../Models/Set';
import { API_URL } from './apiConfig';

@Injectable({
    providedIn: 'root'
})
export class SetsService {

    private apiUrl = API_URL;
    
    constructor(private http: HttpClient) {}

    getSets(): Observable<Set[]> {
        return this.http.get<Set[]>(`${this.apiUrl}/sets/`);
    }
    getSetsByMatch(matchId:number): Observable<Set[]> {
        return this.http.get<Set[]>(`${this.apiUrl}/sets/${matchId}`);
    }

    getMatchSet(setId: number): Observable<Set> {
        return this.http.get<Set>(`${this.apiUrl}/sets/${setId}/`);
    }

    // writer: the page that controls the match (the server refuses writes from another page)
    createSet(set: Set & { writer?: string }): Observable<Set> {
        return this.http.post<Set>(`${this.apiUrl}/sets/create/`, set);
    }

    updateSet(id: number, scores: {home_score: number, guest_score: number, writer?: string}): Observable<Set> {
        return this.http.put<Set>(`${this.apiUrl}/sets/update/${id}/`, scores);
    }

    deleteSet(id: number, writer?: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/sets/delete/${id}/`, { params: writer ? { writer } : {} });
    }
}
