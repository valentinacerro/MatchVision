import { Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable } from 'rxjs'
import { API_URL } from './apiConfig'

// Something that happened in a set besides touches (substitution, time-out, card)
export interface GameEvent {
    event_type: string
    set: number
    team: 'home' | 'guests'
    details: any
    home_score: number
    guest_score: number
    client_id: string
}

@Injectable({
    providedIn: 'root'
})
export class EventsService {

    private apiUrl = API_URL

    constructor(private http: HttpClient) {}

    createEvent(event: GameEvent): Observable<GameEvent> {
        return this.http.post<GameEvent>(`${this.apiUrl}/events/create/`, event)
    }

    getSetEvents(setId: number): Observable<GameEvent[]> {
        return this.http.get<GameEvent[]>(`${this.apiUrl}/sets/${setId}/events/`)
    }
}
