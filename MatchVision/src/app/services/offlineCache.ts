import { inject } from '@angular/core'
import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http'
import { catchError, of, tap, throwError, timeout } from 'rxjs'
import { API_URL } from './apiConfig'
import { AuthService } from './authService'

// Last answer of every API read, per account, on this device: without a connection the pages show
// it instead of an error. Kept apart for each account, removed at logout.

const PREFIX = 'matchvision.cache.' // + user id + '.' + url
const INDEX = 'matchvision.cacheIndex.' // + user id: url -> [time, size]
const MAX_CHARS = 1_500_000
const GET_TIMEOUT_MS = 10000 // a Wi-Fi without internet would otherwise keep the page waiting for minutes

export const OFFLINE_HEADER = 'X-MatchVision-Offline'

type Index = Record<string, [number, number]>

function readIndex(user: number): Index {
    try { return JSON.parse(localStorage.getItem(INDEX + user) ?? '{}') } catch { return {} }
}

function store(user: number, url: string, body: unknown): void {
    try {
        const text = JSON.stringify(body)
        if (text.length > MAX_CHARS / 4) return
        const index = readIndex(user)
        index[url] = [Date.now(), text.length]
        // The oldest answers go first when the space is over
        let total = Object.values(index).reduce((sum, [, size]) => sum + size, 0)
        for (const [old] of Object.entries(index).sort((a, b) => a[1][0] - b[1][0])) {
            if (total <= MAX_CHARS || old === url) break
            total -= index[old][1]
            delete index[old]
            localStorage.removeItem(PREFIX + user + '.' + old)
        }
        localStorage.setItem(PREFIX + user + '.' + url, text)
        localStorage.setItem(INDEX + user, JSON.stringify(index))
    } catch {} // a full storage only means no copy for offline use
}

function read(user: number, url: string): unknown {
    try {
        const text = localStorage.getItem(PREFIX + user + '.' + url)
        return text === null ? undefined : JSON.parse(text)
    } catch { return undefined }
}

export function clearOfflineCache(user: number): void {
    try {
        Object.keys(readIndex(user)).forEach(url => localStorage.removeItem(PREFIX + user + '.' + url))
        localStorage.removeItem(INDEX + user)
    } catch {}
}

export const offlineCacheInterceptor: HttpInterceptorFn = (req, next) => {
    if (req.method !== 'GET' || !req.url.startsWith(API_URL)) return next(req)
    const user = inject(AuthService).user()?.id
    if (user === undefined) return next(req)
    const url = req.urlWithParams
    return next(req).pipe(
        timeout(GET_TIMEOUT_MS),
        tap(event => { if (event instanceof HttpResponse && event.status === 200) store(user, url, event.body) }),
        catchError(err => {
            // Only when the server cannot be reached: a refusal (401, 404...) is a real answer
            const unreachable = err?.name === 'TimeoutError' || (err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 502))
            const cached = unreachable ? read(user, url) : undefined
            if (cached === undefined) return throwError(() => err)
            return of(new HttpResponse({ body: cached, status: 200, url, headers: new HttpHeaders({ [OFFLINE_HEADER]: '1' }) }))
        }),
    )
}
