import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { ActivatedRoute, Router, RouterModule } from '@angular/router'

import { ChangePlayersModalComponent } from "./changePlayersModal/changePlayersModal.component"
import { TouchPadComponent } from './touchPad/touchPad.component'
import { StatsPanelComponent } from './statsPanel/statsPanel.component'
import { NewEventModalComponent } from './newEventModal/newEventModal.component'
import { PlayersDeploymentModal } from './playersDeploymentModal/playersDeploymentModal.component'

import { Player } from '../../Models/Player'
import { Event, EventType } from '../../Models/Event'
import { Touch } from '../../Models/Touch'
import { Set } from '../../Models/Set'
import { Match } from '../../Models/Match'

import { TouchesService } from '../../services/touchesService'
import { GlobalService } from '../../services/globalService'
import { MatchesService } from '../../services/matchesService'
import { RalliesService, Rally } from '../../services/ralliesService'
import { GameEvent } from '../../services/eventsService'
import { OutboxEvent, OutboxService } from '../../services/outboxService'
import { forkJoin, Subscription, switchMap } from 'rxjs'
import {
    afterPoint, DEFAULT_FORMAT, isDecidingSet, MatchFormat, matchWinner, pointReason, PointReason, reasonChoices, serverIndex,
    setsWon, setWinner, sideSwitchDue, suggestFundamental, Team, terminalWinner, touchReason,
} from './rallyEngine'

// A touch as tracked on this page: tap order and rally are fixed when the scout taps.
// Saved on the device at once; the outbox sends it to the server when it can.
type TrackedTouch = Touch & { seq: number; rally: number }

const STATE_KEY = 'matchvision.live.' // + match id, local copy of the live state
const OTHER_DEVICE = 'La partita è stata aperta su un altro dispositivo o è terminata: le modifiche fatte qui non vengono inviate'
const STORAGE_FULL = 'Memoria del dispositivo piena: le ultime modifiche non sono salvate'

// Game state before a score change, so it can be taken back
interface Snapshot {
    home: number; guests: number; serving: Team; rotation: number; rallySeq: number; index: number; sideSwitched: boolean
    rallyIds: string[] // client ids of the touches of the rally this point closed (to reopen it on undo)
}
// A score change caused by a touch (cause = its client_id) or by the scout (cause = null)
interface ScoreEvent { cause: string | null; prev: Snapshot; rallyId?: string; winner?: Team }

// Everything needed to resume a match that is being scouted (saved touches are on the server)
interface LiveState {
    v: 1
    writer: string   // id of the page that saved it
    baseRev: number  // last server revision this page knew; the server refuses the save if it moved on
    rev?: number     // assigned by the server
    savedAt: number
    rallySeq: number
    setId: number | null
    setNumber: number
    score: { home: number; guests: number }
    serving: Team
    firstServer: Team
    rotation: number
    index: number
    sideSwitched: boolean
    lineup: number[]
    libero: number | null
    benchLibero: number | null
    bench: number[]
    counters: { changes: number; doubleChanges: number; timeouts: number; yellow: number; red: number }
    results: { home_score: number; guest_score: number }[]
    endSetClicked: boolean
    allSetsPlayed: boolean
    scoreEvents: ScoreEvent[]
    rallyTouchIds: string[] // client ids of the touches of the rally in progress
    order: string[]         // client ids of this set's touches in tap order
    rallyLog: RallyEntry[] // rallies of this set, oldest first
    subs: Substitution[]
    // Saved by earlier versions of this page (now everything waits in the outbox): sent again on resume
    unsent?: TrackedTouch[]
    unsentRallies?: Rally[]
    unsentRallyDeletes?: string[]
    unsentEvents?: GameEvent[]
    liberoFor: number[]
    nextRallyNumber: number
    outForMatch: number[] // injured players replaced by an exceptional substitution (no re-entry)
    guestTimeOuts: number
}

// The copy on this device also has what is needed to resume without a connection
interface LocalState extends LiveState {
    match?: Match
    players?: Player[]
    set?: Set | null
    touches?: TrackedTouch[]
}

// A point of this set: reason '' until known (a "+" without a reason)
interface RallyEntry { id: string; winner: Team; reason?: string }

// A substitution of this set: the starter left for the sub; returned once the starter re-entered
interface Substitution { starter: number; sub: number; returned: boolean }

function newClientId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

@Component({
    selector: 'app-game',
    standalone: true,
    imports: [
        RouterModule,
        ChangePlayersModalComponent,
        TouchPadComponent,
        StatsPanelComponent,
        NewEventModalComponent,
        PlayersDeploymentModal
    ],
    templateUrl: './game.html',
    styleUrls: ['./game.scss']
})

export class GameComponent implements OnInit, OnDestroy{

    private outbox = inject(OutboxService)
    private outboxEvents: Subscription | null = null

    constructor(private touchesService: TouchesService,
        private matchesService: MatchesService,
        private ralliesService: RalliesService,
        public globalService: GlobalService,
        private router: Router,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef) {}

    @ViewChild(ChangePlayersModalComponent) changePlayersModal!: ChangePlayersModalComponent
    @ViewChild(StatsPanelComponent) statsPanel!: StatsPanelComponent
    @ViewChild(NewEventModalComponent) newEventModal!: NewEventModalComponent
    @ViewChild(PlayersDeploymentModal) playersDeploymentModal!: PlayersDeploymentModal
                
        // Coordinates [x%, y%]
    left_pos: [number, number][] = [
        [15, 80], // pos 1
        [42, 80], // pos 2
        [42, 50], // pos 3
        [42, 20], // pos 4
        [15, 20], // pos 5
        [15, 50], // pos 6
    ];
    right_pos: [number, number][] = [
        [85, 20], // pos 1
        [58, 20], // pos 2
        [58, 50], // pos 3
        [58, 80], // pos 4
        [85, 80], // pos 5
        [85, 50], // pos 6
    ];
    index: number = 0 // court side
    pos: [number, number][][] = [this.left_pos, this.right_pos]
    rotation: number = 0 // one rotation state shared by both sides

    libero_pos_left: [number, number] = [0, 95] // Libero
    libero_pos_right: [number, number] = [99, 95] // Libero
    libero_pos: [number, number][] = [this.libero_pos_left, this.libero_pos_right]

    score = {home: 0, guests: 0}

    // Rally engine: who serves, the match format and the last automatic point (undo reverts it)
    serving: Team = 'home'
    firstServer: Team = 'home' // who served first in this set; the other team starts the next one
    format: MatchFormat = DEFAULT_FORMAT
    sideSwitched: boolean = false
    suggestion = { completo: '', solo: '', id: 0 }
    // Score changes of this set, newest last: undoing a touch takes back its point only if it is the latest change
    private scoreEvents: ScoreEvent[] = []
    // Every point is also saved as a rally (serve, rotation, winner) for side-out / break-point stats
    rallyLog: RallyEntry[] = []
    // Substitutions of this set (FIVB 15.6: a starter leaves once and re-enters once, for his substitute)
    subs: Substitution[] = []
    // Starters the libero replaces in the back row; empty = libero managed by hand
    liberoFor: number[] = []
    private nextRallyNumber = 1 // only grows within a set (a removed rally keeps its number used)
    outForMatch: number[] = []
    guestTimeOuts: number = 2
    info: string = ''
    private infoTimer: any = null
    private autoSelected: Player | null = null // the server preselected by the app, not by the scout
    manualPick: number = 0 // grows at every player tap by the scout (the pad then accepts a quick grade tap)

    // To insert a touch
    selectedPlayer!: Player | null
    newTouch: Touch = {
        id: -1,
        set: -1, 
        player: -1,
        fundamental: "",
        outcome: "" 
    }
    touches: TrackedTouch[] = [] // of the current set, in tap order (saved on the device, sent by the outbox)
    touchSeq: number = 0
    rallySeq: number = 0 // incremented by every score change
    errors: { [key: string]: string } = {} // one message per operation

    // all players
    players: Player[] = []

    starting_players: Player[] = []
    libero: Player | null = null

    // in panchina
    bench_players: Player[] = []
    bench_libero: Player | null = null
    
    // Counters
    // To change players
    changeCounter: number = 6
    doubleChangeCounter: number = 2
    // To register events
    leftTimeOuts: number = 2 // FIVB: two per set
    y_card_counter: number = 0
    r_card_counter: number = 0
    
    eventOccurred: Event = {event_type: ''}
    
    // To save sets
    newSet!: Set
    setNumber: number = 1
    endSetClicked: boolean = false
    allSetsPlayed: boolean = false
    
    // To save match
    results: { home_score: number; guest_score: number }[] = []
    endingMatch: boolean = false
    
    ngOnInit(): void {
        this.outboxEvents = this.outbox.events.subscribe(e => this.onOutboxEvent(e))
        const routeId = Number(this.route.snapshot.paramMap.get('matchId')) || null
        const currentMatch = this.globalService.currentMatch()
        console.log("dati partita corrente", currentMatch)
        // Coming from a reload, a bookmark or the "Riprendi scout" button: load the match from the server
        if (routeId && (currentMatch?.id !== routeId || currentMatch?.live_state)) {
            this.resume(routeId)
            return
        }
        this.players = this.globalService.currentPlayers()
        this.readFormat(currentMatch)
        this.startNewSet()
    }

    private readFormat(match: any): void {
        if (match?.sets_to_win) {
            this.format = {
                setsToWin: match.sets_to_win,
                setPoints: match.set_points ?? DEFAULT_FORMAT.setPoints,
                tiebreakPoints: match.tiebreak_points ?? DEFAULT_FORMAT.tiebreakPoints,
            }
        }
    }

    // ---------------------------------------------------------------------------------------
    // Resume: the live state is saved locally at once and on the server shortly after
    // ---------------------------------------------------------------------------------------

    resuming: boolean = false
    private saveTimer: any = null
    private queuedState: LiveState | null = null // newest state not yet handed to the outbox
    private readonly writer = newClientId()  // this page
    readOnlyReason: string = ''              // set when this page must not change the match any more

    // Nothing can be changed while resuming or when the match is finished / taken over elsewhere
    get locked(): boolean {
        return this.resuming || !!this.readOnlyReason
    }

    private setReadOnly(reason: string): void {
        this.readOnlyReason = reason
        this.selectedPlayer = null
        clearTimeout(this.saveTimer)
        this.saveTimer = null
        this.queuedState = null
        this.showError('readonly', reason)
    }

    private get matchId(): number | null {
        return this.globalService.currentMatch()?.id || null
    }

    private buildState(): LiveState {
        const id = this.matchId
        return {
            v: 1,
            writer: this.writer,
            baseRev: id ? this.outbox.rev(id) : 0,
            savedAt: Date.now(),
            rallySeq: this.rallySeq,
            setId: this.globalService.currentSet()?.id ?? null,
            setNumber: this.setNumber,
            score: { ...this.score },
            serving: this.serving,
            firstServer: this.firstServer,
            rotation: this.rotation,
            index: this.index,
            sideSwitched: this.sideSwitched,
            lineup: this.starting_players.map(p => p.id),
            libero: this.libero?.id ?? null,
            benchLibero: this.bench_libero?.id ?? null,
            bench: this.bench_players.map(p => p.id),
            counters: { changes: this.changeCounter, doubleChanges: this.doubleChangeCounter, timeouts: this.leftTimeOuts, yellow: this.y_card_counter, red: this.r_card_counter },
            results: this.results,
            endSetClicked: this.endSetClicked,
            allSetsPlayed: this.allSetsPlayed,
            scoreEvents: this.scoreEvents.slice(-50),
            rallyTouchIds: this.touches.filter(t => t.rally === this.rallySeq && t.client_id).map(t => t.client_id as string),
            order: this.touches.filter(t => t.client_id).map(t => t.client_id as string),
            rallyLog: this.rallyLog,
            subs: this.subs,
            liberoFor: this.liberoFor,
            nextRallyNumber: this.nextRallyNumber,
            outForMatch: this.outForMatch,
            guestTimeOuts: this.guestTimeOuts,
        }
    }

    // Saved on the device at once; the server gets the newest state shortly after, through the outbox
    saveState(): void {
        const id = this.matchId
        if (!id || this.endingMatch || this.locked) return
        const state = this.buildState()
        this.saveLocal(id, state)
        this.queuedState = state
        clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => this.flushState(), 800)
    }

    private flushState(): void {
        this.saveTimer = null
        const id = this.matchId
        const state = this.queuedState
        this.queuedState = null
        if (!id || !state || this.endingMatch || this.readOnlyReason) return
        this.record(() => this.outbox.enqueueState(id, state, this.writer))
    }

    private saveLocal(id: number, state: LiveState): void {
        const local: LocalState = { ...state, match: this.globalService.currentMatch() ?? undefined, players: this.players,
            set: this.globalService.currentSet(), touches: this.touches }
        try {
            localStorage.setItem(STATE_KEY + id, JSON.stringify(local))
            this.clearError('storage')
        } catch (err) {
            this.showError('storage', STORAGE_FULL, err)
        }
    }

    // A change goes to the device storage first: if that fails the scout must know, and nothing changes
    private record(write: () => void): boolean {
        try {
            write()
            return true
        } catch (err) {
            this.showError('storage', STORAGE_FULL, err)
            return false
        }
    }

    private moveLocalState(from: number, to: number): void {
        try {
            const raw = localStorage.getItem(STATE_KEY + from)
            if (raw === null) return
            localStorage.setItem(STATE_KEY + to, raw)
            localStorage.removeItem(STATE_KEY + from)
        } catch {}
    }

    private readLocalState(id: number): LocalState | null {
        try {
            const raw = localStorage.getItem(STATE_KEY + id)
            return raw ? JSON.parse(raw) : null
        } catch { return null }
    }

    private resume(id: number): void {
        // A match created offline that has reached the server meanwhile: open it by its server id
        const real = this.outbox.resolve(id)
        if (real !== id) {
            this.moveLocalState(id, real)
            this.router.navigate(['/game', real], { replaceUrl: true })
            id = real
        }
        this.resuming = true
        const local = this.readLocalState(id)
        if (this.outbox.hasResults(id)) {
            this.resuming = false
            this.setReadOnly('Questa partita è terminata su questo dispositivo: i dati si stanno sincronizzando')
            return
        }
        // Changes of this device are still waiting for the server: its copy is the newest one
        if (this.canResumeLocally(local) && this.outbox.pendingFor(id) > 0) {
            this.resumeLocally(local)
            return
        }
        forkJoin({ match: this.matchesService.getMatch(id), sets: this.matchesService.getMatchSets(id) }).pipe(
            switchMap(({ match, sets }) => this.globalService.getPlayersByTeamId(match.team_id).pipe(
                switchMap(players => [{ match, sets, players }])
            ))
        ).subscribe({
            next: ({ match, sets, players }) => {
                this.globalService.currentMatch.set(match)
                this.globalService.currentPlayers.set(players)
                this.players = players
                this.readFormat(match)
                // A finished match (results saved, no live state) cannot be reopened, not even from a local copy
                if (!match.live_state && match.results?.length) {
                    try { localStorage.removeItem(STATE_KEY + id) } catch {}
                    this.resuming = false
                    this.setReadOnly('Questa partita è terminata: aprila da Partite → Dettagli')
                    return
                }
                // The server copy, unless this device has changes on top of it that did not reach the server
                const server = (match.live_state?.v === 1 ? match.live_state : null) as LiveState | null
                const localIsNewer = !!local && local.v === 1 && local.writer !== undefined &&
                    (!server || (local.baseRev === (server.rev ?? 0) && local.savedAt > server.savedAt))
                const state = localIsNewer ? local : server
                this.outbox.setRev(id, Math.max(this.outbox.rev(id), server?.rev ?? 0))
                if (!state) {
                    this.resuming = false
                    if (sets.length === 0) {
                        this.startNewSet() // created but never started
                    } else {
                        this.setReadOnly('Questa partita non ha uno stato salvato e non può essere ripresa: aprila da Partite → Dettagli')
                    }
                    return
                }
                this.applyState(state, players)
                const set = sets.find(s => s.id === this.outbox.resolve(state.setId ?? 0)) ?? null
                this.globalService.currentSet.set(set)
                if (localIsNewer && local?.touches) {
                    this.touches = this.localTouches(local)
                    this.finishResume(state, true)
                    return
                }
                if (!set) {
                    if (state.setId && !state.endSetClicked) this.showError('set', 'Il set in corso era stato eliminato: premi NUOVO SET')
                    this.finishResume(state, true)
                    return
                }
                this.touchesService.getSetTouches(set.id).subscribe({
                    next: (touches) => {
                        // Tap order and rally of each touch as saved; the rest are earlier rallies at the end
                        this.touches = touches.map(t => ({ ...t, seq: this.seqOf(state, t.client_id), rally: this.rallyOf(state, t.client_id) }))
                            .sort((a, b) => a.seq - b.seq)
                        this.finishResume(state, true)
                    },
                    error: (err) => {
                        this.showError('resume', 'Tocchi del set non caricati: undo non disponibile per i tocchi precedenti', err)
                        this.finishResume(state, true)
                    }
                })
            },
            error: (err) => {
                // No connection: the copy on this device is enough to go on
                if (this.canResumeLocally(local)) {
                    this.resumeLocally(local)
                    return
                }
                this.resuming = false
                this.showError('match', 'Partita non disponibile senza connessione: aprila una volta con la rete attiva, poi funziona anche offline', err)
            }
        })
    }

    private canResumeLocally(local: LocalState | null): local is LocalState {
        return !!local && local.v === 1 && !!local.match && !!local.players
    }

    // Everything comes from the copy on this device (no server needed)
    private resumeLocally(local: LocalState): void {
        const players = local.players as Player[]
        this.globalService.currentMatch.set(local.match as Match)
        this.globalService.currentPlayers.set(players)
        this.players = players
        this.readFormat(local.match)
        this.applyState(local, players)
        this.globalService.currentSet.set(local.set ? { ...local.set, id: this.outbox.resolve(local.set.id) } : null)
        this.touches = this.localTouches(local)
        this.finishResume(local, false)
    }

    // Touches of a set created offline point to its temporary id until the server gave it one
    private localTouches(local: LocalState): TrackedTouch[] {
        return (local.touches ?? []).map(t => ({ ...t, set: this.outbox.resolve(t.set) })).sort((a, b) => a.seq - b.seq)
    }

    private applyState(s: LiveState, players: Player[]): void {
        const byId = (id: number | null) => players.find(p => p.id === id) ?? null
        this.setNumber = s.setNumber
        this.score = { ...s.score }
        this.serving = s.serving
        this.firstServer = s.firstServer
        this.rotation = s.rotation
        this.index = s.index
        this.sideSwitched = s.sideSwitched
        this.starting_players = s.lineup.map(byId).filter((p): p is Player => !!p)
        this.libero = byId(s.libero)
        this.bench_libero = byId(s.benchLibero)
        this.bench_players = s.bench.map(byId).filter((p): p is Player => !!p)
        this.changeCounter = s.counters.changes
        this.doubleChangeCounter = s.counters.doubleChanges
        this.leftTimeOuts = s.counters.timeouts
        this.y_card_counter = s.counters.yellow
        this.r_card_counter = s.counters.red
        this.results = s.results
        this.endSetClicked = s.endSetClicked
        this.allSetsPlayed = s.allSetsPlayed
        this.scoreEvents = s.scoreEvents ?? []
        this.rallyLog = s.rallyLog ?? []
        this.subs = s.subs ?? []
        this.liberoFor = s.liberoFor ?? []
        this.nextRallyNumber = s.nextRallyNumber ?? ((s.rallyLog ?? []).length + 1)
        this.outForMatch = s.outForMatch ?? []
        this.guestTimeOuts = s.guestTimeOuts ?? 2
        this.rallySeq = s.rallySeq ?? 0
        this.touchSeq = (s.order ?? []).length + 1000 // re-sent and new touches come after the known ones
    }

    // Saved tap position of a touch (unknown ones keep the server order, after the known ones)
    private seqOf(s: LiveState, clientId: string | undefined): number {
        const i = clientId ? (s.order ?? []).indexOf(clientId) : -1
        return i >= 0 ? i : ++this.touchSeq
    }

    private rallyOf(s: LiveState, clientId: string | undefined): number {
        return clientId && (s.rallyTouchIds ?? []).includes(clientId) ? this.rallySeq : -1
    }

    private finishResume(state: LiveState, online: boolean): void {
        this.resuming = false
        this.clearError('match')
        this.touchSeq = Math.max(this.touchSeq, ...this.touches.map(t => t.seq))
        this.queueLegacy(state)
        this.updateSuggestion()
        const id = this.matchId
        if (!id) return
        const blocked = this.outbox.blockedReason(id)
        if (blocked) {
            this.setReadOnly(OTHER_DEVICE)
            return
        }
        // Opening the match here takes control of it: the other device can no longer write.
        // The claim waits in the outbox behind the changes not sent yet, so those still reach the server
        const claim = this.buildState()
        this.saveLocal(id, claim)
        this.record(() => this.outbox.enqueueState(id, claim, this.writer))
        this.showInfo(online ? 'Partita ripresa' : 'Partita ripresa senza connessione: i dati si inviano quando torna la rete', online ? 3000 : 6000)
        if (online) this.reconcileRallies()
    }

    // States saved by an earlier version of this page kept unsent data in the state itself
    private queueLegacy(state: LiveState): void {
        const id = this.matchId
        if (!id) return
        const known = new globalThis.Set(this.touches.map(t => t.client_id))
        this.record(() => {
            for (const t of state.unsent ?? []) {
                const { seq, rally, uncertain, id: _, ...payload } = t as any
                this.outbox.enqueue('touch', id, payload, this.writer)
                if (!known.has(t.client_id)) this.touches = [...this.touches, { ...t, seq: this.seqOf(state, t.client_id), rally: this.rallyOf(state, t.client_id) }]
            }
            for (const clientId of state.unsentRallyDeletes ?? []) this.outbox.enqueue('rallyDelete', id, { client_id: clientId }, this.writer)
            for (const r of state.unsentRallies ?? []) this.outbox.enqueue('rally', id, r, this.writer)
            for (const e of state.unsentEvents ?? []) this.outbox.enqueue('event', id, e, this.writer)
        })
        this.touches = [...this.touches].sort((a, b) => a.seq - b.seq)
    }

    // Rallies on the server that this state does not know (e.g. saved by a device that then lost
    // control) are removed, so side-out / break-point match the score
    private reconcileRallies(): void {
        const set = this.globalService.currentSet()
        const id = this.matchId
        if (!set?.id || set.id < 0 || !id) return
        this.ralliesService.getSetRallies(set.id).subscribe({
            next: (rallies) => {
                const known = new globalThis.Set(this.rallyLog.map(r => r.id))
                rallies.filter(r => !known.has(r.client_id)).forEach(r => this.record(() => this.outbox.removeRally(id, r.client_id, this.writer)))
                const maxNumber = Math.max(0, ...rallies.map(r => r.number))
                if (maxNumber >= this.nextRallyNumber) this.nextRallyNumber = maxNumber + 1
            },
            error: (err) => console.error('Errore controllo rally', err),
        })
    }

    // What the outbox reports while this page is open
    private onOutboxEvent(e: OutboxEvent): void {
        const id = this.matchId
        if (e.type === 'resolved') {
            // The match created offline is on the server: same page, server id in the address
            const match = this.globalService.currentMatch()
            if (match?.id === e.temp) {
                this.moveLocalState(e.temp, e.id)
                this.globalService.currentMatch.set({ ...match, id: e.id })
                this.router.navigate(['/game', e.id], { replaceUrl: true })
            }
            // A set created offline got its server id: everything here points to it from now on
            const set = this.globalService.currentSet()
            if (set?.id === e.temp) this.globalService.currentSet.set({ ...set, id: e.id })
            this.touches = this.touches.map(t => t.set === e.temp ? { ...t, set: e.id } : t)
            if (id && !this.locked && !this.endingMatch) this.saveLocal(id, this.buildState())
        } else if (e.type === 'blocked' && id && this.outbox.resolve(id) === e.match) {
            this.setReadOnly(OTHER_DEVICE)
        } else if (e.type === 'rejected' && id && this.outbox.resolve(e.op.match) === this.outbox.resolve(id)) {
            this.showError('rejected', 'Una modifica è stata rifiutata dal server: controlla i dati della partita nei Dettagli')
        }
        this.cdr.detectChanges()
    }

    // Leaving clears the global match state; "Riprendi scout" reloads it
    ngOnDestroy(): void {
        clearTimeout(this.infoTimer)
        this.outboxEvents?.unsubscribe()
        // The newest state goes to the outbox now, so "Riprendi scout" finds it
        if (this.saveTimer) {
            clearTimeout(this.saveTimer)
            this.flushState()
        }
        this.globalService.resetAll()
    }

    // "+" = rally won by that team: serve and rotation follow the rules. Why it was won can be
    // picked in the "Ultimo punto" box until the next point
    increaseScore(team: Team) {
        this.awardPoint(team)
    }

    get lastPoint(): RallyEntry | null {
        return this.rallyLog.at(-1) ?? null
    }

    get lastPointReason(): PointReason | undefined {
        return pointReason(this.lastPoint?.reason)
    }

    // The last point has no reason from a touch or a card: the scout can say what happened
    get lastPointChoices(): PointReason[] {
        const last = this.lastPoint
        if (!last || (this.lastPointReason && !this.lastPointReason.choice)) return []
        return reasonChoices(last.winner)
    }

    chooseReason(choice: PointReason): void {
        const last = this.lastPoint
        const id = this.matchId
        if (!last || !id || this.locked || choice.team !== last.winner) return
        const reason = last.reason === choice.code ? '' : choice.code // a second tap takes it back
        const cause = reason ? choice.long : ''
        if (!this.record(() => this.outbox.updateRally(id, last.id, { reason, cause }, this.writer))) return
        this.rallyLog = [...this.rallyLog.slice(0, -1), { ...last, reason }]
        this.saveState()
    }

    // "−" = correction. If the latest score change was a point for that team, it is taken back
    // completely (score, serve, rotation, its rally); otherwise only the score goes back.
    decreaseScore(team: Team) {
        if (this.score[team] === 0) return
        const last = this.scoreEvents.length - 1
        if (last >= 0 && this.scoreEvents[last].winner === team) {
            this.restoreEvent(last)
            this.showInfo('Punto annullato')
            this.updateSuggestion()
            this.saveState()
            return
        }
        this.recordEvent(null)
        this.score[team]--
        // The score went back: the last point of that team is removed from the rally stats too
        const lastRally = [...this.rallyLog].reverse().find(r => r.winner === team)
        if (lastRally) this.removeRally(lastRally.id)
        this.closeRally()
        this.updateSuggestion()
        this.saveState()
    }

    private snapshot(): Snapshot {
        const rallyIds = this.touches.filter(t => t.rally === this.rallySeq && t.client_id).map(t => t.client_id as string)
        return { home: this.score.home, guests: this.score.guests, serving: this.serving, rotation: this.rotation,
            rallySeq: this.rallySeq, index: this.index, sideSwitched: this.sideSwitched, rallyIds }
    }

    // cause: client_id of the touch that scored, null for a change made by the scout
    private recordEvent(cause: string | null): void {
        this.scoreEvents = [...this.scoreEvents.slice(-49), { cause, prev: this.snapshot() }]
    }

    private awardPoint(winner: Team, cause: string = '', causeId: string | null = null, reason: string = ''): void {
        const before = { serving: this.serving, rotation: this.rotation }
        this.recordEvent(causeId)
        this.scoreEvents[this.scoreEvents.length - 1].winner = winner
        this.score[winner]++
        const rally = this.newRally(before, winner, cause, reason)
        if (rally) {
            this.scoreEvents[this.scoreEvents.length - 1].rallyId = rally.client_id
            this.rallyLog = [...this.rallyLog, { id: rally.client_id, winner, reason }]
            this.sendRally(rally)
        }
        const next = afterPoint(before, winner)
        this.serving = next.serving
        this.rotation = next.rotation
        // After a rotation the libero may have left the court: a selection off court is void
        if (!this.selectedOnCourt) this.selectedPlayer = null
        this.closeRally()
        if (cause) this.showInfo(`Punto ${winner === 'home' ? 'CASA' : 'OSPITI'} (${cause})${next.rotated ? ' · rotazione' : ''}`)
        if (!this.sideSwitched && sideSwitchDue(this.score, this.setNumber, this.format)) {
            this.sideSwitched = true
            this.switchSide()
            this.showInfo('Tie-break a 8 punti: cambio campo')
        }
        this.updateSuggestion()
        this.saveState()
        const setWon = setWinner(this.score, this.setNumber, this.format)
        if (setWon && !this.endSetClicked) {
            const who = setWon === 'home' ? 'CASA' : 'OSPITI'
            if (confirm(`Set ${this.setNumber} vinto da ${who} ${this.score.home}-${this.score.guests}: chiudere il set?`)) this.endSet()
        }
    }

    private newRally(before: { serving: Team; rotation: number }, winner: Team, cause: string, reason: string): Rally | null {
        const set = this.globalService.currentSet()
        if (!set?.id) return null
        const p1 = this.starting_players.length === 6 ? this.starting_players[serverIndex(before.rotation)] : null
        return {
            set: set.id,
            number: this.nextRallyNumber++,
            serving: before.serving,
            rotation: before.rotation,
            p1_player: p1?.id ?? null,
            winner,
            home_score: this.score.home,
            guest_score: this.score.guests,
            cause: cause.slice(0, 40),
            reason,
            client_id: newClientId(),
        }
    }

    // Saved on the device and sent by the outbox (the client id makes a repeated create harmless)
    private sendRally(rally: Rally): void {
        const id = this.matchId
        if (id) this.record(() => this.outbox.enqueue('rally', id, rally, this.writer))
    }

    // A rally still waiting is simply not sent; one already on the server is deleted there
    private removeRally(clientId: string): void {
        this.rallyLog = this.rallyLog.filter(r => r.id !== clientId)
        const id = this.matchId
        if (id) this.record(() => this.outbox.removeRally(id, clientId, this.writer))
    }

    // Events (substitutions, time-outs, cards) go through the outbox like rallies
    private recordGameEvent(event_type: string, details: any = {}, team: Team = 'home'): void {
        const set = this.globalService.currentSet()
        const id = this.matchId
        if (!set?.id || !id) return
        const event: GameEvent = { event_type, set: set.id, team, details, home_score: this.score.home, guest_score: this.score.guests,
            client_id: newClientId(), created_at: new Date().toISOString() }
        this.record(() => this.outbox.enqueue('event', id, event, this.writer))
    }

    // Who serves: chosen at the start of the set, can be corrected at any time (no rotation)
    setServing(team: Team): void {
        if (this.endSetClicked || this.locked || team === this.serving) return
        if (this.score.home === 0 && this.score.guests === 0) this.firstServer = team
        this.recordEvent(null)
        this.serving = team
        this.updateSuggestion()
        this.saveState()
    }

    get serverIdx(): number {
        return serverIndex(this.rotation)
    }

    // Suggested fundamental for the pad; at the start of a home serve the server is preselected too
    updateSuggestion(): void {
        const rally = this.touches
            .filter(t => t.rally === this.rallySeq)
            .sort((a, b) => a.seq - b.seq)
            .map(t => t.fundamental)
        this.suggestion = {
            completo: suggestFundamental(this.serving, rally, false),
            solo: suggestFundamental(this.serving, rally, true),
            id: this.suggestion.id + 1,
        }
        const free = !this.selectedPlayer || this.selectedPlayer.id === this.autoSelected?.id // never override the scout's choice
        if (rally.length === 0 && this.serving === 'home' && this.starting_players.length === 6 && !this.endSetClicked) {
            if (free) {
                this.selectedPlayer = this.starting_players[this.serverIdx]
                this.autoSelected = this.selectedPlayer
            }
        } else if (this.autoSelected) {
            // The preselection no longer applies (the serve passed, a touch was undone...)
            if (this.selectedPlayer?.id === this.autoSelected.id) this.selectedPlayer = null
            this.autoSelected = null
        }
    }

    showInfo(message: string, ms: number = 3000): void {
        this.info = message
        clearTimeout(this.infoTimer)
        this.infoTimer = setTimeout(() => {
            this.info = ''
            this.cdr.detectChanges()
        }, ms)
        this.cdr.detectChanges()
    }

    // Removing the touch that scored takes back its point, serve, rotation and side switch,
    // but only if nothing changed the score after it
    private revertPointOf(clientId: string | undefined): void {
        if (!clientId) return
        const i = this.scoreEvents.findIndex(e => e.cause === clientId)
        if (i < 0) return
        if (i !== this.scoreEvents.length - 1) {
            this.scoreEvents = this.scoreEvents.filter((_, j) => j !== i)
            this.showInfo('Tocco eliminato: il punto resta, il punteggio è cambiato dopo')
            return
        }
        this.restoreEvent(i)
        this.showInfo('Punto annullato')
    }

    // Takes back the latest score change i: state before it, its rally, the rally reopened
    private restoreEvent(i: number): void {
        const p = this.scoreEvents[i].prev
        const rallyId = this.scoreEvents[i].rallyId
        this.scoreEvents = this.scoreEvents.slice(0, i)
        if (rallyId) this.removeRally(rallyId)
        this.score.home = p.home
        this.score.guests = p.guests
        this.serving = p.serving
        this.rotation = p.rotation
        this.index = p.index
        this.sideSwitched = p.sideSwitched
        // The rally goes on: touches recorded after the point belong to it again
        const reopened = this.rallySeq
        const closed = new globalThis.Set(p.rallyIds ?? [])
        const back = (t: TrackedTouch) => t.rally === reopened || (!!t.client_id && closed.has(t.client_id))
        this.touches = this.touches.map(t => back(t) ? { ...t, rally: p.rallySeq } : t)
        this.rallySeq = p.rallySeq
        if (!this.selectedOnCourt) this.selectedPlayer = null
    }

    private closeRally(): void {
        this.rallySeq++
        this.clearError('rally')
        this.clearError('zero')
    }

    touchLabel(t: Touch): string {
        const player = [...this.players, ...this.starting_players].find(p => p.id === t.player)
        return `${player ? '#' + player.number + ' ' : ''}${t.fundamental} ${t.outcome}`
    }

    get lastTouchText(): string {
        const last = this.touches.at(-1)
        return last ? this.touchLabel(last) : ''
    }

    // Every touch is on the device from the tap on, so any of them can be undone, even offline
    get canUndo(): boolean {
        return this.touches.length > 0 && !this.endSetClicked && !this.locked
    }

    // The live state (lineup, score, rotation) exists only on this page
    get gameInProgress(): boolean {
        return !!this.globalService.currentMatch()?.id
    }

    // Errors stay on screen until the same operation succeeds or the scout closes them
    showError(key: string, message: string, err?: any): void {
        if (err) console.error(message, err)
        this.errors = { ...this.errors, [key]: message }
        this.cdr.detectChanges()
    }

    clearError(key: string): void {
        if (!(key in this.errors)) return
        const { [key]: _, ...rest } = this.errors
        this.errors = rest
    }

    get errorList(): string[] {
        return Object.values(this.errors)
    }


    get hasActiveSet(): boolean {
        return !!this.globalService.currentSet()?.id
    }

    // Tap on a player in the court selects it for the pad (tap again to deselect)
    selectPlayer(player: Player): void {
        if (this.endSetClicked) {
            this.showError('locked', 'Set chiuso: premi NUOVO SET per continuare')
            return
        }
        // Tapping the server preselected by the app confirms it instead of deselecting it
        if (this.locked) return
        this.manualPick++
        const confirmsAuto = this.autoSelected?.id === player.id && this.selectedOnCourt?.id === player.id
        this.selectedPlayer = !confirmsAuto && this.selectedOnCourt?.id === player.id ? null : player
        this.autoSelected = null
    }

    // The selection counts only while that player is on court: a substitution, a libero swap,
    // a new lineup or a new set make it void
    get selectedIsLibero(): boolean {
        const p = this.selectedOnCourt
        return !!p && (p.id === this.libero?.id || p.id === this.bench_libero?.id)
    }

    get selectedOnCourt(): Player | null {
        const p = this.selectedPlayer
        if (!p) return null
        return this.onCourt.some(s => s.id === p.id) ? p : null
    }

    // ---- Libero (FIVB 19): replaces the chosen players when they are in the back row,
    // except the one in position 1 while the team serves (the libero cannot serve)
    get liberoAuto(): boolean {
        return !!this.libero && this.liberoFor.length > 0
    }

    displayedAt(i: number): Player {
        const p = this.starting_players[i]
        return this.liberoSlot === i ? this.libero as Player : p
    }

    // Lineup index where the libero is now, or -1. Only one position at a time, even if the
    // chosen players could be in the back row together (the first in P1, P6, P5 order wins).
    get liberoSlot(): number {
        if (!this.liberoAuto || this.starting_players.length !== 6) return -1
        for (const position of [0, 5, 4]) { // P1, P6, P5
            const i = (position + this.rotation) % 6
            const p = this.starting_players[i]
            const serves = position === 0 && this.serving === 'home'
            if (this.liberoFor.includes(p.id) && !serves) return i
        }
        return -1
    }

    get liberoOnCourt(): boolean {
        return this.liberoAuto && this.starting_players.some((_, i) => this.displayedAt(i).id === this.libero?.id)
    }

    // Who can touch the ball now: the six shown on court, plus the libero when managed by hand
    get onCourt(): Player[] {
        const shown = this.starting_players.map((_, i) => this.displayedAt(i))
        if (this.libero && !this.liberoAuto) shown.push(this.libero)
        return shown
    }

    onTouchEntered(event: {fundamental: string; outcome: string}): void {
        if (!this.selectedOnCourt) {
            this.selectedPlayer = null
            this.showError('touch', 'Tocca prima un giocatore in campo')
            return
        }
        const clientId = this.registerNewTouch(event)
        this.selectedPlayer = null
        this.autoSelected = null
        if (!clientId) return
        const winner = terminalWinner(event.fundamental, event.outcome)
        if (winner) {
            this.awardPoint(winner, `${event.fundamental} ${event.outcome}`, clientId, touchReason(event.fundamental, event.outcome))
        } else {
            this.updateSuggestion()
        }
    }

    openStats(): void { this.statsPanel.open() }

    // Between FINE SET and NUOVO SET the scoreboard still shows the closed set and its score
    get displayedSetNumber(): number {
        return this.endSetClicked && !this.allSetsPlayed ? this.setNumber - 1 : this.setNumber
    }

    get statsSetLabel(): string {
        const set = this.globalService.currentSet()
        return set?.number ? `Set ${set.number}` : 'Set'
    }

    // Change players
    openChangePlayersModal(): void { this.changePlayersModal.open() }

    openNewEventModal(): void {
        this.eventOccurred.event_type = '' // no leftover choice from a closed modal
        this.eventOccurred.team = 'home'
        this.newEventModal.open()
    }

    openPlayersDeploymentModal() { this.playersDeploymentModal.open() }

    swapLiberos(): void {
        let temp = this.libero
        this.libero = this.bench_libero
        this.bench_libero = temp
        this.onLineupChanged() }

    // A player who leaves the court loses the selection for good (not only while off court)
    onLineupChanged(): void {
        if (!this.selectedOnCourt) this.selectedPlayer = null
        this.updateSuggestion() // e.g. a new server after a substitution in position 1
        this.saveState()
    }

    // Substitution requested in the modal: checked against the rules, then applied
    applyChange(change: { out: Player[]; in: Player[]; exceptional?: boolean }): void {
        const { out, in: entering } = change
        if (this.endSetClicked || this.locked) {
            this.showError('change', 'Set chiuso: i cambi valgono per il prossimo set, premi NUOVO SET')
            return
        }
        if (out.length === 0 || out.length !== entering.length) {
            this.showError('change', 'Seleziona lo stesso numero di giocatori in uscita e in entrata')
            return
        }
        if (change.exceptional) {
            this.applyExceptionalChange(out, entering)
            return
        }
        if (this.changeCounter < out.length) {
            this.showError('change', `Cambi esauriti: ne restano ${this.changeCounter} (6 per set)`)
            return
        }
        const problem = out.map((p, i) => this.substitutionProblem(p, entering[i])).find(m => !!m)
        if (problem) {
            this.showError('change', problem)
            return
        }
        this.clearError('change')
        let lineup = [...this.starting_players]
        let bench = [...this.bench_players]
        out.forEach((p, i) => {
            const q = entering[i]
            lineup = lineup.map(x => x.id === p.id ? q : x) // same position in the rotation
            this.liberoFor = this.liberoFor.map(id => id === p.id ? q.id : id) // the libero keeps replacing that position
            bench = [...bench.filter(x => x.id !== q.id), p]
            const open = this.subs.find(s => s.sub === p.id && s.starter === q.id && !s.returned)
            this.subs = open
                ? this.subs.map(s => s === open ? { ...s, returned: true } : s)
                : [...this.subs, { starter: p.id, sub: q.id, returned: false }]
        })
        this.starting_players = lineup
        this.bench_players = bench
        this.changeCounter -= out.length // a double change counts as two
        this.recordGameEvent(out.length === 2 ? 'DOUBLE_CHANGE' : 'CHANGE', { out: out.map(p => p.id), in: entering.map(p => p.id) })
        this.showInfo(out.map((p, i) => `#${entering[i].number} per #${p.number}`).join(', '))
        this.onLineupChanged()
    }

    // FIVB 15.7: an injured player who cannot be replaced legally is replaced by anyone not on court;
    // it does not count as a substitution and the injured player cannot come back in this match
    private applyExceptionalChange(out: Player[], entering: Player[]): void {
        if (out.length !== 1) {
            this.showError('change', 'Il cambio eccezionale è uno per uno')
            return
        }
        const [p, q] = [out[0], entering[0]]
        if (this.outForMatch.includes(q.id)) {
            this.showError('change', `#${q.number} è uscito per infortunio: non può rientrare in questa partita`)
            return
        }
        this.clearError('change')
        this.starting_players = this.starting_players.map(x => x.id === p.id ? q : x)
        this.bench_players = [...this.bench_players.filter(x => x.id !== q.id), p]
        this.liberoFor = this.liberoFor.map(id => id === p.id ? q.id : id)
        this.outForMatch = [...this.outForMatch, p.id]
        this.recordGameEvent('MEDICAL_CHANGE', { out: [p.id], in: [q.id] })
        this.showInfo(`Cambio eccezionale: #${q.number} per #${p.number} (infortunio)`)
        this.onLineupChanged()
    }

    // Why this substitution is not allowed, or '' (FIVB 15.6)
    private substitutionProblem(out: Player, entering: Player): string {
        if (this.outForMatch.includes(entering.id)) return `#${entering.number} è uscito per infortunio: non può rientrare in questa partita`
        const asSub = this.subs.find(s => s.sub === out.id && !s.returned)
        if (asSub) {
            // A substitute can leave only for the starter he replaced
            return asSub.starter === entering.id ? '' : `#${out.number} può uscire solo per far rientrare #${this.numberOf(asSub.starter)}`
        }
        if (this.subs.some(s => s.starter === out.id && s.returned)) return `#${out.number} è già uscito e rientrato: non può più essere sostituito in questo set`
        if (this.subs.some(s => s.sub === entering.id)) return `#${entering.number} è già entrato in questo set: non può rientrare`
        const waiting = this.subs.find(s => s.starter === entering.id && !s.returned)
        if (waiting) return `#${entering.number} può rientrare solo al posto di #${this.numberOf(waiting.sub)}`
        return ''
    }

    private numberOf(id: number): string {
        return String(this.players.find(p => p.id === id)?.number ?? '?')
    }
    
    // CAMBIO CAMPO pressed by the scout: a correction, so it blocks undoing earlier points
    togglePos(): void {
        this.recordEvent(null)
        this.switchSide()
    }

    private switchSide(): void {
        this.index = this.index === 0 ? 1 : 0
        this.saveState()
        this.cdr.detectChanges()
    }

    
    registerNewEvent(): void {
        // Time-outs and cards can be for either team (chosen in the modal, CASA by default)
        const team: Team = this.eventOccurred.team ?? 'home'
        if (this.eventOccurred.event_type !== EventType.TECHNICAL_TIMEOUT) this.clearError('timeout')
        if ((this.endSetClicked || !this.hasActiveSet || this.locked) && this.eventOccurred.event_type) {
            this.showError('locked', 'Set chiuso: premi NUOVO SET per registrare eventi')
            this.eventOccurred = {event_type: ''}
            return
        }
        const who = team === 'home' ? 'CASA' : 'OSPITI'
        switch(this.eventOccurred.event_type) {
            case EventType.TECHNICAL_TIMEOUT: {
                const left = team === 'home' ? this.leftTimeOuts : this.guestTimeOuts
                if (left === 0) {
                    this.showError('timeout', `Time-out ${who} esauriti in questo set (2 per set)`)
                    break
                }
                if (team === 'home') this.leftTimeOuts--
                else this.guestTimeOuts--
                this.clearError('timeout')
                this.recordGameEvent('TECHNICAL_TIMEOUT', {}, team)
                this.showInfo(`Time-out ${who}`)
                break
            }
            case EventType.YELLOW_CARD:
                if (team === 'home') this.y_card_counter++
                this.recordGameEvent('YELLOW_CARD', {}, team)
                this.showInfo(`Cartellino giallo ${who}`)
                break
            case EventType.RED_CARD:
                // FIVB 21.3: a penalty gives a point and the serve to the opponent of the sanctioned team
                if (team === 'home') this.r_card_counter++
                this.recordGameEvent('RED_CARD', {}, team)
                this.awardPoint(team === 'home' ? 'guests' : 'home', `Cartellino rosso ${who}`, null, team === 'home' ? 'penalty' : 'opp_penalty')
                break
            case EventType.DOUBLE_FAULT:
                this.cancelCurrentRally()
                break
        }
        this.eventOccurred = {event_type: ''}
        this.saveState()
    }

    // Replayed point: delete only the touches of the rally in progress
    cancelCurrentRally(): void {
        if (this.endSetClicked) {
            this.showError('locked', 'Set chiuso: premi NUOVO SET per continuare')
            return
        }
        const rallyTouches = this.touches.filter(t => t.rally === this.rallySeq)
        if (rallyTouches.length === 0) {
            this.showError('rally', 'Palla contesa: nessun tocco da eliminare in questo rally')
            return
        }
        const count = rallyTouches.length === 1 ? '1 tocco' : `${rallyTouches.length} tocchi`
        if (!confirm(`Palla contesa: eliminare ${count} del rally in corso?`)) return
        rallyTouches.forEach(t => this.deleteTouch(t))
    }

    // Delete last touch
    undoLastTouch(): void {
        const last = this.touches.at(-1)
        if (last && this.canUndo) this.deleteTouch(last)
    }

    // A touch still waiting is simply not sent; one already on the server is deleted there.
    // Its point, if it scored, is taken back (only if nothing changed the score after it)
    deleteTouch(touch: TrackedTouch): void {
        const id = this.matchId
        if (!id || this.locked) return
        if (!this.record(() => this.outbox.removeTouch(id, touch, this.writer))) return
        this.touches = this.touches.filter(t => t !== touch)
        this.revertPointOf(touch.client_id)
        this.clearError('touch')
        this.updateSuggestion()
        this.saveState()
        this.cdr.detectChanges()
    }

    // Create new touch
    // Returns the client id of the touch recorded, or null
    registerNewTouch(event: {fundamental: string; outcome: string}): string | null {
        const currentSet = this.globalService.currentSet()
        const id = this.matchId
        if(!currentSet || !currentSet.id || !id || this.endSetClicked || this.locked) {
            this.showError('touch', 'Nessun set attivo: tocco non registrato')
            return null
        }
        if (!this.selectedPlayer || !event.fundamental || !event.outcome) return null
        const touch: TrackedTouch = { id: -1, set: currentSet.id, player: this.selectedPlayer.id, fundamental: event.fundamental,
            outcome: event.outcome, client_id: newClientId(), seq: ++this.touchSeq, rally: this.rallySeq }
        const { id: _, seq, rally, ...payload } = touch
        if (!this.record(() => this.outbox.enqueue('touch', id, payload, this.writer))) return null
        this.touches = [...this.touches, touch]
        this.clearError('touch')
        this.clearError('rally')
        this.saveState() // an unsent touch survives a reload
        return touch.client_id as string
    }

    // Manual rotation (correction): the player in position 2 goes to 1, 1 goes to 6, ...
    doRotation(): void {
        this.recordEvent(null)
        this.rotation = (this.rotation + 1) % 6
        this.updateSuggestion()
        this.saveState()
    }

    playerPos(i: number): [number, number] {
        return this.pos[this.index][(i - this.rotation + 6) % 6]
    }

    assignPlayers(event: any) {
        this.selectedPlayer = null
        this.liberoFor = event.liberoFor ?? []
        // I..VI are the positions now on court: with the set under way (rotation > 0) the lineup
        // is stored so that each player shows up in the position chosen
        const chosen: Player[] = (event.startingPlayers as Player[]).filter(p => !this.outForMatch.includes(p.id))
        if (chosen.length !== (event.startingPlayers as Player[]).length) {
            this.showError('change', 'Un giocatore uscito per infortunio non può rientrare in questa partita')
            return
        }
        const lineup: Player[] = new Array(6)
        chosen.forEach((p, k) => lineup[(k + this.rotation) % 6] = p)
        this.starting_players = chosen.length === 6 ? lineup : chosen
        if (this.score.home + this.score.guests > 0) this.recordGameEvent('LINEUP', { lineup: this.starting_players.map(p => p.id), rotation: this.rotation })
        this.libero = event.libero
        this.bench_players = event.benchPlayers
        this.bench_libero = event.benchLibero
        this.updateSuggestion()
        this.saveState()
    }

    startNewSet(){
        if (this.endingMatch || this.readOnlyReason) return
        const currentMatch = this.globalService.currentMatch()
        if (!currentMatch || !currentMatch.id) {
            this.showError('match', 'Nessuna partita attiva: torna alle partite e creane una')
            return
        }

        // Creation and population of teamPlayers
        const teamPlayers: number[] = []
        this.players.forEach((p, index) => teamPlayers.push(p.id))
        this.bench_players.forEach((p, index) => teamPlayers.push(p.id))
        if (this.libero) {
            teamPlayers.push(this.libero.id)
            if(this.bench_libero){
                teamPlayers.push(this.bench_libero.id)
        }}

        this.newSet = {
            id: 0,
            match: currentMatch.id,
            number: this.setNumber,
            home_score: 0,
            guest_score: 0,
            players: [],
            player_ids: teamPlayers
        }
        
        this.createSet(this.newSet)
        
    }
    
    // The set exists at once on this device with a temporary id; the outbox creates it on the server
    // and everything recorded in it meanwhile follows
    createSet(set: Set) {
        const lastResult = this.results.at(-1)
        const id = this.matchId
        if(lastResult && lastResult.home_score === 0 && lastResult.guest_score === 0 && this.setNumber != 1){
            this.showError('set', 'Il set precedente è finito 0-0: nuovo set non creato')
            return
        }
        if (!id) return
        const temp = this.outbox.tempId()
        const body = { temp, client_id: newClientId(), number: set.number, player_ids: set.player_ids }
        if (!this.record(() => this.outbox.enqueue('set', id, body, this.writer))) return
        this.clearError('set')
        this.clearError('touch')
        this.clearError('match')
        this.globalService.currentSet.set({ ...set, id: temp })
        this.resetVariables()
    }

    resetVariables() {
        this.selectedPlayer = null

        this.starting_players = []
        this.libero = null
        this.bench_libero = null
        this.bench_players  = []

        this.touches = []
        this.rallySeq++
        this.score.guests = 0
        this.score.home = 0
        this.rotation = 0
        this.scoreEvents = []
        this.rallyLog = []
        this.sideSwitched = false
        if (this.setNumber > 1 && isDecidingSet(this.setNumber, this.format)) {
            // Deciding set: a new toss decides serve and sides
            this.showInfo('Tie-break: nuovo sorteggio. Scegli chi batte (palla accanto a CASA/OSPITI) e usa CAMBIO CAMPO se serve', 10000)
        } else if (this.setNumber > 1) {
            // New set: the teams change court and the other team serves first
            this.firstServer = this.firstServer === 'home' ? 'guests' : 'home'
            this.index = this.index === 0 ? 1 : 0
        }
        this.serving = this.firstServer

        this.changeCounter = 6
        this.doubleChangeCounter = 2
        this.subs = []
        this.leftTimeOuts = 2
        this.guestTimeOuts = 2
        this.nextRallyNumber = 1
        // Sanctions (cards) are for the whole match: the counters are not reset

        this.endSetClicked = false
        this.clearError('locked')
        this.updateSuggestion()
        this.saveState()

        this.cdr.detectChanges()
    }

    // After FINE SET: next set number, unless the match is won or all its sets are played
    handleNextSet() {
        const lastSet = this.format.setsToWin * 2 - 1
        if (matchWinner(this.results, this.format) || this.setNumber >= lastSet) {
            this.allSetsPlayed = true
        } else {
            this.setNumber = this.setNumber + 1
        }
        this.cdr.detectChanges()
    }

    confirmEndSet() {
        if (this.score.home === 0 && this.score.guests === 0) {
            this.showError('zero', 'Punteggio 0-0: aggiorna il punteggio prima di chiudere il set')
            return
        }
        if (!confirm(`Chiudere il set ${this.setNumber} sul ${this.score.home}-${this.score.guests}?`)) return
        this.endSet()
    }

    endSet() {
        // Update set
        const currentSet = this.globalService.currentSet()
        const id = this.matchId
        if(!currentSet || !currentSet.id || !id){
            this.showError('set', 'Nessun set attivo da chiudere')
            return
        }
        const updatedScores = {
            home_score: this.score.home,
            guest_score: this.score.guests
        }
        if (!this.record(() => this.outbox.enqueue('setScore', id, { set: currentSet.id, ...updatedScores }, this.writer))) return
        this.clearError('set')
        this.results = [...this.results, updatedScores]
        this.endSetClicked = true
        this.selectedPlayer = null
        this.scoreEvents = []
        const won = matchWinner(this.results, this.format)
        if (won) {
            const sets = setsWon(this.results)
            this.showInfo(`Partita vinta da ${won === 'home' ? 'CASA' : 'OSPITI'} ${sets.home}-${sets.guests}: premi FINE MATCH`, 10000)
        }
        this.handleNextSet()
        this.saveState()
    }

    // A set opened (NUOVO SET) but never played
    get currentSetUnstarted(): boolean {
        return this.hasActiveSet && !this.endSetClicked && this.score.home === 0 && this.score.guests === 0 && this.touches.length === 0
    }

    get canEndMatch(): boolean {
        return !this.endingMatch && this.results.length > 0
            && (this.endSetClicked || this.currentSetUnstarted || !this.hasActiveSet)
    }

    confirmEndMatch() {
        const emptySet = this.currentSetUnstarted ? ' Il set vuoto appena aperto verrà eliminato.' : ''
        if (!confirm(`Terminare la partita?${emptySet} Non potrai più registrare tocchi.`)) return
        this.endMatch()
    }

    // The last played set is already recorded by FINE SET; an empty set opened by mistake is removed.
    // Everything waits in the outbox: the match can be ended without a connection
    endMatch() {
        const id = this.matchId
        if (!id) {
            this.showError('match', 'Nessuna partita a cui salvare i risultati')
            return
        }
        clearTimeout(this.saveTimer) // a late live-state save must not bring the match back
        this.saveTimer = null
        this.queuedState = null
        const current = this.globalService.currentSet()
        const ended = this.record(() => {
            if (!this.endSetClicked && current?.id) this.outbox.removeSet(id, current.id, this.writer)
            this.outbox.enqueue('results', id, { results: this.results }, this.writer)
        })
        if (!ended) return
        this.endingMatch = true
        try { localStorage.removeItem(STATE_KEY + id) } catch {}
        this.globalService.resetAll()
        this.router.navigate(['/'])
    }
}
