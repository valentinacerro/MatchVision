import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { API_URL } from './apiConfig'

// One point of a set, as recorded by the game screen
export interface Rally {
    set: number
    number: number
    serving: 'home' | 'guests'
    rotation: number
    p1_player: number | null
    winner: 'home' | 'guests'
    home_score: number
    guest_score: number
    cause: string
    client_id: string
    writer?: string // the page that owns the match
}

@Injectable({
    providedIn: 'root'
})
export class RalliesService {

    private apiUrl = API_URL

    constructor(private http: HttpClient) {}

    createRally(rally: Rally): Observable<Rally> {
        return this.http.post<Rally>(`${this.apiUrl}/rallies/create/`, rally)
    }

    // By client id: an undo can delete a rally whose server id the page never received
    deleteRally(clientId: string, writer?: string): Observable<any> {
        return this.http.delete(`${this.apiUrl}/rallies/delete/${clientId}/`, { params: writer ? { writer } : {} })
    }

    getSetRallies(setId: number): Observable<Rally[]> {
        return this.http.get<Rally[]>(`${this.apiUrl}/sets/${setId}/rallies/`)
    }
}
