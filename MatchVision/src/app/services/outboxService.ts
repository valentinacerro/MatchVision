import { effect, inject, Injectable, signal, untracked } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable, Subject, timeout } from 'rxjs'
import { API_URL } from './apiConfig'
import { AuthService } from './authService'

// Everything the game screen changes on the server goes through this queue. Each change is saved on
// the device first, then sent in the order it happened, one at a time, as soon as there is a connection:
// a match scouted without signal reaches the server later, even if the game page is closed.

export type OpKind =
    | 'match' | 'touch' | 'touchDelete' | 'rally' | 'rallyDelete' | 'event'
    | 'set' | 'setScore' | 'setDelete' | 'state' | 'results'

export interface Op {
    id: string
    kind: OpKind
    match: number   // may be a temporary (negative) id, see tempId()
    writer?: string // the page that recorded it: the server accepts writes only from the page that controls the match
    body: any
    at: number
}

export type OutboxEvent =
    | { type: 'resolved'; temp: number; id: number }        // a match or set created offline got its server id
    | { type: 'blocked'; match: number; reason: string }    // another device took control of the match
    | { type: 'rejected'; op: Op; status: number }          // refused by the server for good
    | { type: 'sent'; op: Op; response: any }

interface Stored {
    ops: Op[]
    ids: Record<string, number>     // temporary id -> server id
    revs: Record<string, number>    // match -> last live-state revision confirmed by the server
    blocked: Record<string, string> // match -> why its changes cannot be sent
    rejected: Op[]
}

const KEY = 'matchvision.outbox.' // + user id
const REQUEST_TIMEOUT_MS = 15000
const RETRY_MS = [1000, 2000, 5000, 10000, 30000]
const CREATES: OpKind[] = ['touch', 'rally', 'event']
const DELETES: OpKind[] = ['touchDelete', 'rallyDelete', 'setDelete'] // 404 = already gone

function newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function empty(): Stored {
    return { ops: [], ids: {}, revs: {}, blocked: {}, rejected: [] }
}

@Injectable({
    providedIn: 'root'
})
export class OutboxService {

    private http = inject(HttpClient)
    private auth = inject(AuthService)
    private apiUrl = API_URL

    private user: number | null = null
    private data: Stored = empty()
    private inFlight: string | null = null
    private retryTimer: any = null
    private attempt = 0
    private tempSeq = 0

    readonly events = new Subject<OutboxEvent>()
    readonly pending = signal(0)          // changes waiting to reach the server
    readonly blockedCount = signal(0)     // matches whose changes cannot be sent
    readonly rejectedCount = signal(0)
    readonly version = signal(0)          // grows at every change of the queue (for computed values)
    readonly lastError = signal('')       // why the last attempt failed ('' when it worked)

    constructor() {
        // Each account has its own queue; it is sent while that account is logged in
        effect(() => {
            const user = this.auth.user()?.id ?? null
            untracked(() => this.load(user))
        })
        window.addEventListener('online', () => this.retryNow())
        // A tablet coming back from standby does not wait for the next retry
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.retryNow() })
    }

    // ---- recording ----------------------------------------------------------------------------

    // Id for something created before the server gives it one (negative, unique on this device)
    tempId(): number {
        this.tempSeq = (this.tempSeq + 1) % 1000
        return -(Date.now() * 1000 + this.tempSeq)
    }

    // The server id of a temporary id, once known
    resolve(id: number): number {
        return id < 0 ? (this.data.ids[String(id)] ?? id) : id
    }

    // Throws if the device storage is full: the caller must tell the scout
    enqueue(kind: OpKind, match: number, body: any, writer?: string): Op {
        const op: Op = { id: newId(), kind, match, writer, body, at: Date.now() }
        this.change(d => d.ops.push(op))
        return op
    }

    // The live state: only the newest one matters, so a waiting one is replaced (same page only:
    // a page that took control after a reload must not jump ahead of the changes of the previous one)
    enqueueState(match: number, state: any, writer: string): void {
        const waiting = this.data.ops.find(o => o.kind === 'state' && this.same(o.match, match) && o.writer === writer && o.id !== this.inFlight)
        if (!waiting) {
            this.enqueue('state', match, state, writer)
            return
        }
        this.change(d => {
            const op = d.ops.find(o => o.id === waiting.id)
            if (op) Object.assign(op, { body: state, at: Date.now() })
        })
    }

    // Undo of a touch: if it is still waiting it is simply not sent, otherwise it is deleted on the server
    removeTouch(match: number, touch: { client_id?: string; id?: number }, writer: string): void {
        const cancelled = touch.client_id && this.cancel(o => o.kind === 'touch' && o.body.client_id === touch.client_id)
        if (!cancelled) this.enqueue('touchDelete', match, { client_id: touch.client_id, id: touch.id }, writer)
    }

    removeRally(match: number, clientId: string, writer: string): void {
        if (!this.cancel(o => o.kind === 'rally' && o.body.client_id === clientId))
            this.enqueue('rallyDelete', match, { client_id: clientId }, writer)
    }

    // A set opened but never played; one created offline and still waiting is dropped with its score
    removeSet(match: number, setId: number, writer: string): void {
        const cancelled = setId < 0 && this.cancel(o => (o.kind === 'set' && o.body.temp === setId) || (o.kind === 'setScore' && o.body.set === setId))
        if (!cancelled) this.enqueue('setDelete', match, { set: setId }, writer)
    }

    // ---- what is waiting ----------------------------------------------------------------------

    pendingFor(match: number): number {
        return this.data.ops.filter(o => this.same(o.match, match)).length
    }

    // Matches created on this device and not on the server yet (temporary id)
    localMatches(): any[] {
        this.version() // read by templates: they follow the queue
        return this.data.ops.filter(o => o.kind === 'match').map(o => {
            const { temp, ...match } = o.body
            return { ...match, id: temp, local: true }
        })
    }

    // The end of this match is recorded but not on the server yet
    hasResults(match: number): boolean {
        return this.data.ops.some(o => o.kind === 'results' && this.same(o.match, match))
    }

    // A touch, rally or event still waiting to be sent
    isWaiting(clientId: string | undefined): boolean {
        return !!clientId && this.data.ops.some(o => CREATES.includes(o.kind) && o.body.client_id === clientId)
    }

    blockedReason(match: number): string {
        return this.data.blocked[String(this.resolve(match))] ?? ''
    }

    rev(match: number): number {
        return this.data.revs[String(this.resolve(match))] ?? 0
    }

    // The revision the server has now (when the match is opened online with nothing waiting)
    setRev(match: number, rev: number): void {
        this.change(d => { d.revs[String(this.resolve(match))] = rev })
    }

    // The changes of a blocked match are thrown away (the other device's version is kept)
    discardBlocked(): void {
        this.change(d => {
            d.ops = d.ops.filter(o => !d.blocked[String(this.resolve(o.match))])
            d.blocked = {}
        })
    }

    discardRejected(): void {
        this.change(d => { d.rejected = [] })
    }

    // The changes not sent yet stay on this device and leave at the next login of this account
    logout(): void {
        const n = this.pending()
        if (n > 0 && !confirm(`${n === 1 ? 'C\'è 1 modifica' : `Ci sono ${n} modifiche`} non ancora inviate al server: restano su questo dispositivo e partono al prossimo accesso con questo account. Uscire?`)) return
        this.auth.logout()
    }

    retryNow(): void {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
        this.attempt = 0
        this.kick()
    }

    // ---- sending ------------------------------------------------------------------------------

    private kick(): void {
        if (this.inFlight || this.retryTimer || this.user === null) return
        const op = this.data.ops.find(o => !this.data.blocked[String(this.resolve(o.match))])
        if (!op) return
        if (navigator.onLine === false) return // the 'online' event starts again
        const user = this.user
        this.inFlight = op.id
        this.request(op).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: (res) => this.sent(user, op, res),
            error: (err) => this.failed(user, op, err),
        })
    }

    private sent(user: number, op: Op, res: any): void {
        this.inFlight = null
        if (user !== this.user) return // another account logged in meanwhile: its queue is loaded
        this.attempt = 0
        this.lastError.set('')
        const key = String(this.resolve(op.match))
        this.change(d => {
            d.ops = d.ops.filter(o => o.id !== op.id)
            if ((op.kind === 'set' || op.kind === 'match') && res?.id) d.ids[String(op.body.temp)] = res.id
            if (op.kind === 'state') d.revs[key] = res?.live_state?.rev ?? (d.revs[key] ?? 0) + 1
            if (op.kind === 'results') delete d.revs[key]
        })
        if ((op.kind === 'set' || op.kind === 'match') && res?.id) this.events.next({ type: 'resolved', temp: op.body.temp, id: res.id })
        this.events.next({ type: 'sent', op, response: res })
        this.kick()
    }

    private failed(user: number, op: Op, err: any): void {
        this.inFlight = null
        if (user !== this.user) return
        const status: number = err?.status ?? 0
        if (status === 404 && DELETES.includes(op.kind)) {
            this.sent(user, op, null)
            return
        }
        if (status === 401) return // the login page opens; the queue goes on after the login
        if (status === 409) {
            const reason = err?.error?.error ?? 'Partita aperta su un altro dispositivo'
            const match = this.resolve(op.match)
            this.change(d => { d.blocked[String(match)] = reason })
            this.events.next({ type: 'blocked', match, reason })
            this.kick() // other matches can still be sent
            return
        }
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
            console.error('Modifica rifiutata dal server', op, err)
            this.change(d => {
                d.ops = d.ops.filter(o => o.id !== op.id)
                d.rejected.push(op)
            })
            this.events.next({ type: 'rejected', op, status })
            this.kick()
            return
        }
        // No connection, timeout, server error: again later, waiting a bit longer each time
        this.lastError.set(status === 0 ? 'Nessuna connessione con il server' : `Errore del server (${status})`)
        const delay = RETRY_MS[Math.min(this.attempt++, RETRY_MS.length - 1)]
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            this.kick()
        }, delay)
    }

    private request(op: Op): Observable<any> {
        const r = (id: number) => this.resolve(id)
        const b = op.body
        const writer = op.writer
        const params: Record<string, string> = writer ? { writer } : {}
        switch (op.kind) {
            case 'match': {
                const { temp, ...match } = b
                return this.http.post(`${this.apiUrl}/matches/create/`, match)
            }
            case 'touch': return this.http.post(`${this.apiUrl}/touches/create/`, { ...b, set: r(b.set), writer })
            case 'touchDelete': return b.client_id
                ? this.http.delete(`${this.apiUrl}/touches/delete/client/${encodeURIComponent(b.client_id)}/`, { params })
                : this.http.delete(`${this.apiUrl}/touches/delete/${b.id}/`, { params })
            case 'rally': return this.http.post(`${this.apiUrl}/rallies/create/`, { ...b, set: r(b.set), writer })
            case 'rallyDelete': return this.http.delete(`${this.apiUrl}/rallies/delete/${encodeURIComponent(b.client_id)}/`, { params })
            case 'event': return this.http.post(`${this.apiUrl}/events/create/`, { ...b, set: r(b.set), writer })
            case 'set': {
                const { temp, ...set } = b
                return this.http.post(`${this.apiUrl}/sets/create/`, { ...set, match: r(op.match), writer })
            }
            case 'setScore': return this.http.put(`${this.apiUrl}/sets/update/${r(b.set)}/`, { home_score: b.home_score, guest_score: b.guest_score, writer })
            case 'setDelete': return this.http.delete(`${this.apiUrl}/sets/delete/${r(b.set)}/`, { params })
            case 'state': return this.http.put(`${this.apiUrl}/matches/update/${r(op.match)}/`, {
                // The revision is the latest one confirmed when the state leaves, not when it was recorded
                live_state: { ...b, setId: b.setId === null ? null : r(b.setId), baseRev: this.rev(op.match) },
            })
            case 'results': return this.http.put(`${this.apiUrl}/matches/update/${r(op.match)}/`, { results: b.results, live_state: null, writer })
        }
    }

    // ---- storage ------------------------------------------------------------------------------

    private same(a: number, b: number): boolean {
        return this.resolve(a) === this.resolve(b)
    }

    private cancel(match: (op: Op) => boolean): boolean {
        const before = this.data.ops.length
        this.change(d => { d.ops = d.ops.filter(o => o.id === this.inFlight || !match(o)) })
        return this.data.ops.length < before
    }

    // Changes and saves the queue; if the device storage is full nothing changes and the error goes up
    private change(update: (d: Stored) => void): void {
        const next: Stored = structuredClone(this.data)
        update(next)
        if (this.user !== null) localStorage.setItem(KEY + this.user, JSON.stringify(next))
        this.data = next
        this.published()
        this.kick()
    }

    private load(user: number | null): void {
        if (user === this.user) return
        clearTimeout(this.retryTimer)
        this.retryTimer = null
        this.inFlight = null
        this.attempt = 0
        this.user = user
        this.data = empty()
        if (user !== null) {
            try {
                const raw = localStorage.getItem(KEY + user)
                if (raw) this.data = { ...empty(), ...JSON.parse(raw) }
            } catch {}
        }
        this.published()
        this.kick()
    }

    private published(): void {
        this.pending.set(this.data.ops.length)
        this.blockedCount.set(Object.keys(this.data.blocked).length)
        this.rejectedCount.set(this.data.rejected.length)
        this.version.update(v => v + 1)
    }
}
