import { provideZonelessChangeDetection, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideHttpClient } from '@angular/common/http'
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { API_URL } from './apiConfig'
import { AuthService } from './authService'
import { OutboxEvent, OutboxService } from './outboxService'

describe('OutboxService', () => {
    let outbox: OutboxService
    let backend: HttpTestingController
    let user: ReturnType<typeof signal<{ id: number } | null>>
    let events: OutboxEvent[]

    const touch = (client_id: string, set = 10) => ({ set, player: 1, fundamental: 'Attacco', outcome: '++', client_id })

    beforeEach(() => {
        try { localStorage.clear() } catch {}
        user = signal<{ id: number } | null>({ id: 1 })
        TestBed.configureTestingModule({
            providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting(),
                { provide: AuthService, useValue: { user, logout: jasmine.createSpy('logout') } }]
        })
        outbox = TestBed.inject(OutboxService)
        backend = TestBed.inject(HttpTestingController)
        TestBed.tick() // loads the queue of the logged-in user
        events = []
        outbox.events.subscribe(e => events.push(e))
    })

    afterEach(() => {
        jasmine.clock().uninstall()
        backend.verify()
    })

    it('sends one change at a time, in the order they happened', () => {
        outbox.enqueue('touch', 3, touch('a'), 'w')
        outbox.enqueue('touch', 3, touch('b'), 'w')
        const first = backend.expectOne(`${API_URL}/touches/create/`)
        expect(first.request.body.client_id).toBe('a')
        expect(first.request.body.writer).toBe('w')
        first.flush({ id: 1 })
        expect(backend.expectOne(`${API_URL}/touches/create/`).request.body.client_id).toBe('b')
        expect(outbox.pending()).toBe(1)
    })

    it('gives the touches of a set created offline its server id', () => {
        const temp = outbox.tempId()
        expect(temp).toBeLessThan(0)
        outbox.enqueue('set', 3, { temp, client_id: 's', number: 2, player_ids: [] }, 'w')
        outbox.enqueue('touch', 3, touch('a', temp), 'w')
        const set = backend.expectOne(`${API_URL}/sets/create/`)
        expect(set.request.body.temp).toBeUndefined()
        expect(set.request.body.match).toBe(3)
        set.flush({ id: 42 })
        expect(backend.expectOne(`${API_URL}/touches/create/`).request.body.set).toBe(42)
        expect(outbox.resolve(temp)).toBe(42)
        expect(events).toContain(jasmine.objectContaining({ type: 'resolved', temp, id: 42 }))
    })

    it('sends only the newest live state, with the newest revision', () => {
        outbox.setRev(3, 5)
        outbox.enqueue('touch', 3, touch('a'), 'w')
        outbox.enqueueState(3, { v: 1, score: 1, setId: null }, 'w')
        outbox.enqueueState(3, { v: 1, score: 2, setId: null }, 'w')
        backend.expectOne(`${API_URL}/touches/create/`).flush({})
        const state = backend.expectOne(`${API_URL}/matches/update/3/`)
        expect(state.request.body.live_state.score).toBe(2)
        expect(state.request.body.live_state.baseRev).toBe(5)
        state.flush({ live_state: { rev: 6 } })
        expect(outbox.rev(3)).toBe(6)
        expect(outbox.pending()).toBe(0)
    })

    it('keeps the state of a page that took control behind the changes of the previous one', () => {
        outbox.enqueueState(3, { v: 1, page: 'old', setId: null }, 'old')
        outbox.enqueue('touch', 3, touch('a'), 'old')
        outbox.enqueueState(3, { v: 1, page: 'new', setId: null }, 'new')
        backend.expectOne(`${API_URL}/matches/update/3/`).flush({ live_state: { rev: 1 } })
        backend.expectOne(`${API_URL}/touches/create/`).flush({})
        expect(backend.expectOne(`${API_URL}/matches/update/3/`).request.body.live_state.page).toBe('new')
    })

    it('does not send an undone touch that was still waiting', () => {
        outbox.enqueue('touch', 3, touch('a'), 'w')
        outbox.enqueue('touch', 3, touch('b'), 'w')
        outbox.removeTouch(3, { client_id: 'b' }, 'w')            // waiting: dropped
        outbox.removeTouch(3, { client_id: 'a' }, 'w')            // on its way: deleted after it arrives
        backend.expectOne(`${API_URL}/touches/create/`).flush({})
        const del = backend.expectOne(r => r.method === 'DELETE')
        expect(del.request.url).toBe(`${API_URL}/touches/delete/client/a/`)
        expect(del.request.params.get('writer')).toBe('w')
        del.flush(null, { status: 404, statusText: 'Not Found' }) // already gone = done
        expect(outbox.pending()).toBe(0)
    })

    it('stops a match taken over by another device, not the others', () => {
        outbox.enqueue('touch', 3, touch('a'), 'w')
        outbox.enqueue('touch', 3, touch('b'), 'w')
        outbox.enqueue('touch', 4, touch('c'), 'w')
        backend.expectOne(`${API_URL}/touches/create/`).flush({ error: 'Partita aperta su un altro dispositivo' }, { status: 409, statusText: 'Conflict' })
        expect(outbox.blockedReason(3)).toContain('altro dispositivo')
        expect(events).toContain(jasmine.objectContaining({ type: 'blocked', match: 3 }))
        expect(backend.expectOne(`${API_URL}/touches/create/`).request.body.client_id).toBe('c')
        expect(outbox.pending()).toBe(3)
        outbox.discardBlocked()
        expect(outbox.blockedCount()).toBe(0)
    })

    it('puts aside a change the server refuses', () => {
        outbox.enqueue('touch', 3, touch('a'), 'w')
        backend.expectOne(`${API_URL}/touches/create/`).flush({ set: ['Invalid pk'] }, { status: 400, statusText: 'Bad Request' })
        expect(outbox.pending()).toBe(0)
        expect(outbox.rejectedCount()).toBe(1)
    })

    it('tries again later when the server cannot be reached', () => {
        jasmine.clock().install()
        outbox.enqueue('touch', 3, touch('a'), 'w')
        backend.expectOne(`${API_URL}/touches/create/`).error(new ProgressEvent('error'), { status: 0 })
        expect(outbox.lastError()).toContain('connessione')
        backend.expectNone(`${API_URL}/touches/create/`)
        jasmine.clock().tick(1000)
        backend.expectOne(`${API_URL}/touches/create/`).flush({})
        expect(outbox.pending()).toBe(0)
        expect(outbox.lastError()).toBe('')
    })

    it('keeps a separate queue for each account', () => {
        jasmine.clock().install()
        outbox.enqueue('touch', 3, touch('a'), 'w')
        backend.expectOne(`${API_URL}/touches/create/`).error(new ProgressEvent('error'), { status: 0 })
        user.set({ id: 2 })
        TestBed.tick()
        expect(outbox.pending()).toBe(0)
        user.set({ id: 1 })
        TestBed.tick()
        expect(outbox.pending()).toBe(1)
        backend.expectOne(`${API_URL}/touches/create/`).flush({})
    })

    it('ends the match after its last changes', () => {
        outbox.setRev(3, 2)
        outbox.enqueue('setScore', 3, { set: 10, home_score: 25, guest_score: 20 }, 'w')
        outbox.enqueue('results', 3, { results: [{ home_score: 25, guest_score: 20 }] }, 'w')
        expect(outbox.hasResults(3)).toBeTrue()
        backend.expectOne(`${API_URL}/sets/update/10/`).flush({})
        const end = backend.expectOne(`${API_URL}/matches/update/3/`)
        expect(end.request.body).toEqual({ results: [{ home_score: 25, guest_score: 20 }], live_state: null, writer: 'w' })
        end.flush({})
        expect(outbox.hasResults(3)).toBeFalse()
        expect(outbox.rev(3)).toBe(0)
    })
})
