import { provideZonelessChangeDetection } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router'
import { API_URL } from './apiConfig'
import { AuthService, authErrorMessages, authInterceptor, nextUrl } from './authService'

describe('AuthService', () => {
    let auth: AuthService
    let http: HttpClient
    let backend: HttpTestingController
    let router: Router

    beforeEach(() => {
        try { localStorage.clear() } catch {}
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection(), provideRouter([]),
                provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()]
        })
        auth = TestBed.inject(AuthService)
        http = TestBed.inject(HttpClient)
        backend = TestBed.inject(HttpTestingController)
        router = TestBed.inject(Router)
        spyOn(router, 'navigate').and.resolveTo(true)
    })

    afterEach(() => backend.verify())

    function logIn(token = 'abc') {
        auth.login('coach@example.com', 'secret').subscribe()
        backend.expectOne(`${API_URL}/auth/login/`).flush({ token, user: { id: 1, email: 'coach@example.com', name: 'Anna', surname: '' } })
    }

    it('keeps the login and sends the token to the API only', () => {
        logIn()
        expect(auth.loggedIn).toBeTrue()
        expect(auth.user()?.name).toBe('Anna')
        http.get(`${API_URL}/matches/`).subscribe()
        expect(backend.expectOne(`${API_URL}/matches/`).request.headers.get('Authorization')).toBe('Token abc')
        http.get('https://example.com/x').subscribe()
        expect(backend.expectOne('https://example.com/x').request.headers.has('Authorization')).toBeFalse()
    })

    it('goes back to the login page when the server refuses the token', () => {
        logIn()
        http.get(`${API_URL}/matches/`).subscribe({ error: () => {} })
        backend.expectOne(`${API_URL}/matches/`).flush({}, { status: 401, statusText: 'Unauthorized' })
        expect(auth.loggedIn).toBeFalse()
        expect(router.navigate).toHaveBeenCalledWith(['/login'], jasmine.objectContaining({ queryParams: jasmine.any(Object) }))
    })

    it('ignores a late 401 of a previous login', () => {
        logIn('old')
        http.get(`${API_URL}/matches/`).subscribe({ error: () => {} })
        logIn('new')
        backend.expectOne(`${API_URL}/matches/`).flush({}, { status: 401, statusText: 'Unauthorized' })
        expect(auth.token).toBe('new')
    })

    it('returns only to pages of the app', () => {
        const route = (next: string | null) => ({ snapshot: { queryParamMap: convertToParamMap(next ? { next } : {}) } }) as ActivatedRoute
        expect(nextUrl(route('/match_details/3'))).toBe('/match_details/3')
        expect(nextUrl(route(null))).toBe('/')
        expect(nextUrl(route('//evil.example'))).toBe('/')
        expect(nextUrl(route('/login'))).toBe('/')
    })

    it('explains why the login failed', () => {
        expect(authErrorMessages({ status: 0 })[0]).toContain('non raggiungibile')
        expect(authErrorMessages({ status: 429 })[0]).toContain('Troppi tentativi')
        expect(authErrorMessages({ status: 400, error: { error: 'Email o password errati' } })).toEqual(['Email o password errati'])
        expect(authErrorMessages({ status: 400, error: { email: ['Esiste già'], password: ['Troppo corta', 'Comune'] } }).length).toBe(3)
    })
})
