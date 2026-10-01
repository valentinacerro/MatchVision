import { inject, Injectable, signal } from '@angular/core'
import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http'
import { ActivatedRoute, CanActivateFn, Router } from '@angular/router'
import { catchError, map, Observable, throwError } from 'rxjs'
import { Account } from '../Models/User'
import { API_URL } from './apiConfig'
import { GlobalService } from './globalService'

const TOKEN_KEY = 'matchvision.token'
const USER_KEY = 'matchvision.user'

interface Session {
    token: string
    user: Account
}

// localStorage can be unavailable (private mode, blocked storage): the login then lasts until reload
function read(key: string): string | null {
    try { return localStorage.getItem(key) } catch { return null }
}

function write(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
    } catch {}
}

function readUser(): Account | null {
    try { return JSON.parse(read(USER_KEY) ?? 'null') } catch { return null }
}

@Injectable({
    providedIn: 'root'
})
export class AuthService {

    private apiUrl = API_URL
    private http = inject(HttpClient)
    private router = inject(Router)
    private globalService = inject(GlobalService)

    private tokenValue: string | null = read(TOKEN_KEY)
    readonly user = signal<Account | null>(this.tokenValue ? readUser() : null)

    get token(): string | null {
        return this.tokenValue
    }

    get loggedIn(): boolean {
        return this.tokenValue !== null
    }

    login(email: string, password: string): Observable<Account> {
        return this.http.post<Session>(`${this.apiUrl}/auth/login/`, { email, password }).pipe(map(s => this.start(s)))
    }

    register(data: { email: string, password: string, name: string, surname: string }): Observable<Account> {
        return this.http.post<Session>(`${this.apiUrl}/auth/register/`, data).pipe(map(s => this.start(s)))
    }

    // Leaves the page first: the game screen may ask to confirm (touches not saved yet)
    async logout(): Promise<void> {
        if (!(await this.router.navigateByUrl('/login'))) return
        const token = this.tokenValue
        this.clear()
        // Ends the session of this device on the server too; other devices stay logged in
        if (token) this.http.post(`${this.apiUrl}/auth/logout/`, {}, { headers: { Authorization: `Token ${token}` } }).subscribe({ error: () => {} })
    }

    // The server refused the token (logged out, or unused for a long time): log in again, then back here
    expired(returnUrl: string): void {
        if (!this.loggedIn) return
        this.clear()
        this.router.navigate(['/login'], { queryParams: { next: returnUrl } })
    }

    private start(session: Session): Account {
        // Lists loaded for another account must not show up
        this.forgetData()
        this.tokenValue = session.token
        write(TOKEN_KEY, session.token)
        write(USER_KEY, JSON.stringify(session.user))
        this.user.set(session.user)
        return session.user
    }

    private clear(): void {
        this.tokenValue = null
        write(TOKEN_KEY, null)
        write(USER_KEY, null)
        this.user.set(null)
        this.forgetData()
    }

    private forgetData(): void {
        this.globalService.allPlayers.set([])
        this.globalService.allTeams.set([])
        this.globalService.allMatches.set([])
        this.globalService.resetAll()
    }
}


// Pages that need a login: without one, go to the login page and come back after it
export const authGuard: CanActivateFn = (_route, state) =>
    inject(AuthService).loggedIn || inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } })


// Adds the token to every API call and handles a session that is no longer valid
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    if (!req.url.startsWith(API_URL) || req.headers.has('Authorization')) return next(req)
    const auth = inject(AuthService)
    const router = inject(Router)
    const token = auth.token
    const request = token ? req.clone({ setHeaders: { Authorization: `Token ${token}` } }) : req
    return next(request).pipe(catchError(err => {
        // Only for the current login: a late answer to a call of a previous session changes nothing
        if (err instanceof HttpErrorResponse && err.status === 401 && token && token === auth.token)
            auth.expired(router.url)
        return throwError(() => err)
    }))
}


// Where to go after login or register: the page that asked for the login, or the dashboard
export function nextUrl(route: ActivatedRoute): string {
    const next = route.snapshot.queryParamMap.get('next') ?? ''
    const inApp = next.startsWith('/') && !next.startsWith('//')
    return inApp && !next.startsWith('/login') && !next.startsWith('/register') ? next : '/'
}

// Messages for the login and register forms
export function authErrorMessages(err: any): string[] {
    if (err?.status === 0) return ['Server non raggiungibile: controlla la connessione']
    if (err?.status === 429) return ['Troppi tentativi: riprova tra un minuto']
    const body = err?.error
    if (body && typeof body === 'object') {
        const messages = Object.values(body).flat().filter((m): m is string => typeof m === 'string')
        if (messages.length) return messages
    }
    return ['Operazione non riuscita: riprova']
}
