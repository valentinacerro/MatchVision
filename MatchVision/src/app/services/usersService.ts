import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User } from '../Models/User';
import { API_URL } from './apiConfig';
@Injectable({
  providedIn: 'root' 
})

export class PlayersService {

  private apiUrl = API_URL;

  constructor(private http: HttpClient) {}

  Login(user: User): Observable<boolean> {
    return this.http.post<boolean>(`${this.apiUrl}/user/login/`, user);
  }

  createUser(user: User): Observable<User> {
    return this.http.post<User>(`${this.apiUrl}/user/create/`, user);
  }

  updatePlayer(id: number, user: User): Observable<User> {
    return this.http.put<User>(`${this.apiUrl}/user/update/${id}/`, user);
  }

  deletePlayer(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/user/delete/${id}/`);
  }
  
}
