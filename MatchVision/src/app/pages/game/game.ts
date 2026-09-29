import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core'
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

import { TouchesService } from '../../services/touchesService'
import { SetsService } from '../../services/setsService'
import { GlobalService } from '../../services/globalService'
import { MatchesService } from '../../services/matchesService'
import { RalliesService, Rally } from '../../services/ralliesService'
import { EventsService, GameEvent } from '../../services/eventsService'
import { forkJoin, switchMap, timeout } from 'rxjs'
import {
    afterPoint, DEFAULT_FORMAT, isDecidingSet, MatchFormat, matchWinner, serverIndex, setsWon, setWinner,
    sideSwitchDue, suggestFundamental, Team, terminalWinner,
} from './rallyEngine'

// A touch as tracked on this page: tap order and rally are fixed when the scout taps.
// uncertain: the request timed out, so the server may have saved it anyway.
type TrackedTouch = Touch & { seq: number; rally: number; uncertain?: boolean }

const REQUEST_TIMEOUT_MS = 15000
const STATE_KEY = 'matchvision.live.' // + match id, local copy of the live state

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
    unsent: TrackedTouch[]  // pending or failed touches, re-sent on resume
    rallyLog: { id: string; winner: Team }[] // rallies of this set, oldest first
    unsentRallies: Rally[]
    unsentRallyDeletes: string[]
    subs: Substitution[]
    unsentEvents: GameEvent[]
    liberoFor: number[]
    nextRallyNumber: number
    outForMatch: number[] // injured players replaced by an exceptional substitution (no re-entry)
    guestTimeOuts: number
}

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

    constructor(private touchesService: TouchesService,
        private setsService: SetsService,
        private matchesService: MatchesService,
        private ralliesService: RalliesService,
        private eventsService: EventsService,
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
    private rallyLog: { id: string; winner: Team }[] = []
    private unsentRallies: Rally[] = []
    private unsentRallyDeletes: string[] = []
    private deletedRallies = new globalThis.Set<string>()
    private rallyRetryTimer: any = null
    // Substitutions of this set (FIVB 15.6: a starter leaves once and re-enters once, for his substitute)
    subs: Substitution[] = []
    private unsentEvents: GameEvent[] = []
    // Starters the libero replaces in the back row; empty = libero managed by hand
    liberoFor: number[] = []
    private nextRallyNumber = 1 // only grows within a set (a removed rally keeps its number used)
    private rallyCreatedAt = new Map<string, number>() // last create attempt: a late create may still land
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
    touches: TrackedTouch[] = [] // confirmed by the server, in tap order
    pendingTouches: TrackedTouch[] = [] // sent, waiting for the server
    failedTouches: TrackedTouch[] = [] // not saved: the scout can retry or discard them
    pendingDeletes: number = 0
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
    endingSet: boolean = false
    creatingSet: boolean = false
    allSetsPlayed: boolean = false
    
    // To save match
    results: { home_score: number; guest_score: number }[] = []
    endingMatch: boolean = false
    
    ngOnInit(): void {
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
    private retryTimer: any = null
    private serverRev: number = 0            // last revision the server confirmed
    private readonly writer = newClientId()  // this page
    private latestState: LiveState | null = null
    readOnlyReason: string = ''              // set when this page must not change the match any more

    // Nothing can be changed while resuming or when the match is finished / taken over elsewhere
    get locked(): boolean {
        return this.resuming || !!this.readOnlyReason
    }

    private setReadOnly(reason: string): void {
        this.readOnlyReason = reason
        this.selectedPlayer = null
        clearTimeout(this.saveTimer)
        clearTimeout(this.retryTimer)
        clearTimeout(this.rallyRetryTimer)
        this.rallyRetryTimer = null
        this.saveTimer = null
        this.showError('readonly', reason)
    }

    private get matchId(): number | null {
        return this.globalService.currentMatch()?.id || null
    }

    private buildState(): LiveState {
        const all = [...this.touches, ...this.pendingTouches, ...this.failedTouches].sort((a, b) => a.seq - b.seq)
        return {
            v: 1,
            writer: this.writer,
            baseRev: this.serverRev,
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
            rallyTouchIds: all.filter(t => t.rally === this.rallySeq && t.client_id).map(t => t.client_id as string),
            order: all.filter(t => t.client_id).map(t => t.client_id as string),
            unsent: [...this.pendingTouches, ...this.failedTouches],
            rallyLog: this.rallyLog,
            unsentRallies: this.unsentRallies,
            unsentRallyDeletes: this.unsentRallyDeletes,
            subs: this.subs,
            unsentEvents: this.unsentEvents,
            liberoFor: this.liberoFor,
            nextRallyNumber: this.nextRallyNumber,
            outForMatch: this.outForMatch,
            guestTimeOuts: this.guestTimeOuts,
        }
    }

    saveState(): void {
        const id = this.matchId
        if (!id || this.endingMatch || this.locked) return
        const state = this.buildState()
        this.latestState = state
        try { localStorage.setItem(STATE_KEY + id, JSON.stringify(state)) } catch {}
        clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => this.pushState(id, state), 800)
    }

    private pushState(id: number, state: LiveState, onSaved?: () => void): void {
        this.saveTimer = null
        clearTimeout(this.retryTimer)
        if (this.endingMatch || this.readOnlyReason) return
        // Always send the newest state, with the newest known server revision
        const toSend = { ...state, baseRev: this.serverRev }
        this.matchesService.updateMatch(id, { live_state: toSend }).subscribe({
            next: (res) => {
                this.serverRev = res.live_state?.rev ?? this.serverRev + 1
                this.clearError('snapshot')
                onSaved?.()
                this.cdr.detectChanges()
            },
            error: (err) => {
                if (err?.status === 409) {
                    // Another device went on with this match, or it is over: do not overwrite it
                    this.setReadOnly('La partita è stata aggiornata da un altro dispositivo o è terminata: ricarica la pagina per riprenderla qui')
                    return
                }
                this.showError('snapshot', 'Stato della partita non salvato sul server: riprovo tra poco', err)
                // Retry only if this is still the newest state and no newer save is on its way
                this.retryTimer = setTimeout(() => {
                    if (!this.saveTimer && this.latestState === state) this.pushState(id, state)
                }, 5000)
            },
        })
    }

    private readLocalState(id: number): LiveState | null {
        try {
            const raw = localStorage.getItem(STATE_KEY + id)
            return raw ? JSON.parse(raw) : null
        } catch { return null }
    }

    private resume(id: number): void {
        this.resuming = true
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
                const local = this.readLocalState(id)
                const server = (match.live_state?.v === 1 ? match.live_state : null) as LiveState | null
                const localIsNewer = !!local && local.v === 1 && local.writer !== undefined &&
                    (!server || (local.baseRev === (server.rev ?? 0) && local.savedAt > server.savedAt))
                const state = localIsNewer ? local : server
                this.serverRev = server?.rev ?? 0
                this.pendingLocalPush = localIsNewer
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
                const set = sets.find(s => s.id === state.setId) ?? null
                this.globalService.currentSet.set(set)
                if (!set) {
                    if (state.setId && !state.endSetClicked) this.showError('set', 'Il set in corso era stato eliminato: premi NUOVO SET')
                    this.finishResume(state)
                    return
                }
                this.touchesService.getSetTouches(set.id).subscribe({
                    next: (touches) => {
                        // Tap order and rally of each touch as saved; the rest are earlier rallies at the end
                        this.touches = touches.map(t => ({ ...t, seq: this.seqOf(state, t.client_id), rally: this.rallyOf(state, t.client_id) }))
                            .sort((a, b) => a.seq - b.seq)
                        this.finishResume(state)
                    },
                    error: (err) => {
                        this.showError('resume', 'Tocchi del set non caricati: undo non disponibile per i tocchi precedenti', err)
                        this.finishResume(state)
                    }
                })
            },
            error: (err) => {
                this.resuming = false
                this.showError('match', 'Partita non caricata: controlla la connessione e ricarica la pagina', err)
            }
        })
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
        this.unsentRallies = s.unsentRallies ?? []
        this.unsentRallyDeletes = s.unsentRallyDeletes ?? []
        this.subs = s.subs ?? []
        this.unsentEvents = s.unsentEvents ?? []
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

    private pendingLocalPush = false

    private finishResume(state: LiveState): void {
        this.resuming = false
        this.clearError('match')
        this.updateSuggestion()
        this.showInfo('Partita ripresa')
        this.cdr.detectChanges()
        // Opening the match here takes control of it: the other device can no longer write.
        // Only then the data not saved before the reload is sent again.
        const id = this.matchId
        if (!id) return
        const claim = this.buildState()
        this.latestState = claim
        try { localStorage.setItem(STATE_KEY + id, JSON.stringify(claim)) } catch {}
        this.pushState(id, claim, () => this.afterClaim(state))
    }

    private afterClaim(state: LiveState): void {
        // Touches not saved before the reload are sent again (their client_id prevents duplicates)
        const saved = new globalThis.Set(this.touches.map(t => t.client_id))
        for (const t of state.unsent ?? []) {
            if (t.client_id && saved.has(t.client_id)) continue
            this.sendTouch({ ...t, seq: this.seqOf(state, t.client_id), rally: this.rallyOf(state, t.client_id) })
        }
        this.unsentRallyDeletes.forEach(id => this.deleteRallyOnServer(id))
        this.unsentRallies.forEach(r => this.sendRally(r))
        this.unsentEvents.forEach(e => this.sendEvent(e))
        this.reconcileRallies()
    }

    // Rallies on the server that this state does not know (e.g. saved by a device that then lost
    // control) are removed, so side-out / break-point match the score
    private reconcileRallies(): void {
        const set = this.globalService.currentSet()
        if (!set?.id) return
        this.ralliesService.getSetRallies(set.id).subscribe({
            next: (rallies) => {
                const known = new globalThis.Set([...this.rallyLog.map(r => r.id), ...this.unsentRallies.map(r => r.client_id)])
                rallies.filter(r => !known.has(r.client_id)).forEach(r => this.deleteRallyOnServer(r.client_id))
                const maxNumber = Math.max(0, ...rallies.map(r => r.number))
                if (maxNumber >= this.nextRallyNumber) this.nextRallyNumber = maxNumber + 1
            },
            error: (err) => console.error('Errore controllo rally', err),
        })
    }

    // Leaving clears the global match state; "Riprendi scout" reloads it from the server
    ngOnDestroy(): void {
        clearTimeout(this.infoTimer)
        clearTimeout(this.retryTimer)
        clearTimeout(this.rallyRetryTimer)
        // Send a pending live-state save now, so "Riprendi scout" finds the latest state
        const id = this.matchId
        if (this.saveTimer && id && !this.endingMatch) {
            clearTimeout(this.saveTimer)
            this.pushState(id, this.buildState())
        }
        this.globalService.resetAll()
    }

    // "+" = rally won by that team: serve and rotation follow the rules
    increaseScore(team: Team) {
        this.awardPoint(team)
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
        const rallyIds = [...this.touches, ...this.pendingTouches, ...this.failedTouches]
            .filter(t => t.rally === this.rallySeq && t.client_id).map(t => t.client_id as string)
        return { home: this.score.home, guests: this.score.guests, serving: this.serving, rotation: this.rotation,
            rallySeq: this.rallySeq, index: this.index, sideSwitched: this.sideSwitched, rallyIds }
    }

    // cause: client_id of the touch that scored, null for a change made by the scout
    private recordEvent(cause: string | null): void {
        this.scoreEvents = [...this.scoreEvents.slice(-49), { cause, prev: this.snapshot() }]
    }

    private awardPoint(winner: Team, cause: string = '', causeId: string | null = null): void {
        const before = { serving: this.serving, rotation: this.rotation }
        this.recordEvent(causeId)
        this.scoreEvents[this.scoreEvents.length - 1].winner = winner
        this.score[winner]++
        const rally = this.newRally(before, winner, cause)
        if (rally) {
            this.scoreEvents[this.scoreEvents.length - 1].rallyId = rally.client_id
            this.rallyLog = [...this.rallyLog, { id: rally.client_id, winner }]
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
        if (setWon && !this.endSetClicked && !this.endingSet) {
            const who = setWon === 'home' ? 'CASA' : 'OSPITI'
            if (confirm(`Set ${this.setNumber} vinto da ${who} ${this.score.home}-${this.score.guests}: chiudere il set?`)) this.endSet()
        }
    }

    private newRally(before: { serving: Team; rotation: number }, winner: Team, cause: string): Rally | null {
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
            client_id: newClientId(),
        }
    }

    // Saved with retries: the client id makes a repeated create harmless
    private sendRally(rally: Rally): void {
        if (!this.unsentRallies.some(r => r.client_id === rally.client_id)) this.unsentRallies = [...this.unsentRallies, rally]
        this.saveState()
        this.rallyCreatedAt.set(rally.client_id, Date.now())
        this.ralliesService.createRally({ ...rally, writer: this.writer }).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: () => {
                this.unsentRallies = this.unsentRallies.filter(r => r.client_id !== rally.client_id)
                // Undone while the create was on its way: delete it now that it exists
                if (this.deletedRallies.has(rally.client_id)) this.deleteRallyOnServer(rally.client_id)
                this.saveState()
            },
            error: (err) => {
                if (err?.status === 409) {
                    this.setReadOnly('La partita è terminata o aperta su un altro dispositivo: ricarica la pagina per riprenderla qui')
                    return
                }
                console.error('Errore salvataggio rally', err)
                this.scheduleRallyRetry()
            }
        })
    }

    private removeRally(id: string): void {
        this.rallyLog = this.rallyLog.filter(r => r.id !== id)
        this.unsentRallies = this.unsentRallies.filter(r => r.client_id !== id)
        this.deletedRallies.add(id)
        this.deleteRallyOnServer(id)
    }

    private deleteRallyOnServer(id: string): void {
        if (!this.unsentRallyDeletes.includes(id)) this.unsentRallyDeletes = [...this.unsentRallyDeletes, id]
        this.ralliesService.deleteRally(id).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: () => this.rallyDeleted(id),
            error: (err) => {
                // 404: not created yet, or already gone. A create sent in the last minute may still
                // land (e.g. after a timeout): keep trying for a while, then give up
                const recent = Date.now() - (this.rallyCreatedAt.get(id) ?? 0) < 60000
                if (err?.status === 404 && !recent) this.rallyDeleted(id)
                else this.scheduleRallyRetry()
            }
        })
    }

    private rallyDeleted(id: string): void {
        this.unsentRallyDeletes = this.unsentRallyDeletes.filter(x => x !== id)
        this.saveState()
    }

    private scheduleRallyRetry(): void {
        if (this.rallyRetryTimer || this.readOnlyReason) return
        this.rallyRetryTimer = setTimeout(() => {
            this.rallyRetryTimer = null
            this.unsentRallyDeletes.forEach(id => this.deleteRallyOnServer(id))
            this.unsentRallies.forEach(r => this.sendRally(r))
            this.unsentEvents.forEach(e => this.sendEvent(e))
        }, 5000)
    }

    // Events (substitutions, time-outs, cards) are saved like rallies: queued, retried, idempotent
    private recordGameEvent(event_type: string, details: any = {}, team: Team = 'home'): void {
        const set = this.globalService.currentSet()
        if (!set?.id) return
        this.sendEvent({ event_type, set: set.id, team, details, home_score: this.score.home, guest_score: this.score.guests,
            client_id: newClientId(), created_at: new Date().toISOString() })
    }

    private sendEvent(event: GameEvent): void {
        if (!this.unsentEvents.some(e => e.client_id === event.client_id)) this.unsentEvents = [...this.unsentEvents, event]
        this.saveState()
        this.eventsService.createEvent({ ...event, writer: this.writer }).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: () => {
                this.unsentEvents = this.unsentEvents.filter(e => e.client_id !== event.client_id)
                this.saveState()
            },
            error: (err) => {
                if (err?.status === 409) {
                    this.setReadOnly('La partita è terminata o aperta su un altro dispositivo: ricarica la pagina per riprenderla qui')
                    return
                }
                console.error('Errore salvataggio evento', err)
                this.scheduleRallyRetry()
            }
        })
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
        const rally = [...this.touches, ...this.pendingTouches]
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
        const retag = (list: TrackedTouch[]) => list.map(t => back(t) ? { ...t, rally: p.rallySeq } : t)
        this.touches = retag(this.touches)
        this.pendingTouches = retag(this.pendingTouches)
        this.failedTouches = retag(this.failedTouches)
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
        const last = [...this.touches, ...this.pendingTouches].sort((a, b) => a.seq - b.seq).at(-1)
        if (!last) return ''
        return this.touchLabel(last) + (this.pendingTouches.includes(last) ? ' (salvataggio…)' : '')
    }

    get failedTouchesText(): string {
        return this.failedTouches.map(t => this.touchLabel(t)).join(', ')
    }

    get canUndo(): boolean {
        return this.touches.length > 0 && this.pendingTouches.length === 0 && this.pendingDeletes === 0 && !this.endSetClicked && !this.endingSet
    }

    get busy(): boolean {
        return this.pendingTouches.length > 0 || this.pendingDeletes > 0
    }

    // The live state (lineup, score, rotation) exists only on this page
    get gameInProgress(): boolean {
        return !!this.globalService.currentMatch()?.id
    }

    // The live state is saved, so leaving or reloading is safe unless some touch is not saved yet
    @HostListener('window:beforeunload', ['$event'])
    onBeforeUnload(event: BeforeUnloadEvent): void {
        if (this.gameInProgress && (this.busy || this.failedTouches.length > 0)) {
            event.preventDefault()
            event.returnValue = ''
        }
    }

    canLeave(): boolean {
        if (!this.gameInProgress || (!this.busy && this.failedTouches.length === 0)) return true
        const n = this.failedTouches.length
        const unsaved = n > 0 ? (n === 1 ? ' 1 tocco non salvato andrà perso.' : ` ${n} tocchi non salvati andranno persi.`) : ' Alcuni tocchi sono ancora in salvataggio.'
        return confirm(`${unsaved.trim()} Uscire comunque? La partita si potrà riprendere da Partite → Riprendi scout.`)
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
            this.awardPoint(winner, `${event.fundamental} ${event.outcome}`, clientId)
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
                this.awardPoint(team === 'home' ? 'guests' : 'home', `Cartellino rosso ${who}`)
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
        if (this.busy) {
            this.showError('busy', 'Salvataggio in corso, riprova tra un attimo')
            return
        }
        const rallyTouches = this.touches.filter(t => t.rally === this.rallySeq)
        const rallyFailed = this.failedTouches.filter(t => t.rally === this.rallySeq)
        const total = rallyTouches.length + rallyFailed.length
        if (total === 0) {
            this.showError('rally', 'Palla contesa: nessun tocco da eliminare in questo rally')
            return
        }
        const count = total === 1 ? '1 tocco' : `${total} tocchi`
        if (!confirm(`Palla contesa: eliminare ${count} del rally in corso?`)) return
        // Unsaved touches of this rally are dropped only after the confirm
        this.dropUnsaved(rallyFailed)
        rallyTouches.forEach(t => this.deleteTouch(t))
    }

    // Delete last touch
    undoLastTouch(): void {
        const last = this.touches.at(-1)
        if (last && this.canUndo) this.deleteTouch(last)
    }

    // key: one message per touch, so one success does not hide another failure
    deleteTouch(touch: TrackedTouch, onFail?: () => void, key: string = `delete-${touch.id}`): void {
        this.pendingDeletes++
        this.touchesService.deleteTouch(touch.id).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: () => this.onTouchDeleted(touch, key),
            error: (err) => {
                // 404: already deleted on the server (e.g. an earlier timed-out delete went through)
                if (err?.status === 404) {
                    this.onTouchDeleted(touch, key)
                    return
                }
                this.pendingDeletes--
                onFail?.()
                this.refreshStatus()
                this.showError(key, `Tocco non eliminato (${this.touchLabel(touch)}): riprova`, err)
            }
        })
    }

    private onTouchDeleted(touch: TrackedTouch, key: string): void {
        this.pendingDeletes--
        this.touches = this.touches.filter(t => t.id !== touch.id)
        this.revertPointOf(touch.client_id)
        this.updateSuggestion()
        this.saveState()
        console.log('Tocco eliminato', touch.id)
        this.clearError(key)
        this.refreshStatus()
        this.cdr.detectChanges()
    }

    // Create new touch
    // Returns the client id of the touch sent, or null
    registerNewTouch(event: {fundamental: string; outcome: string}): string | null {
        const currentSet = this.globalService.currentSet()
        if(!currentSet || !currentSet.id || this.endSetClicked || this.endingSet || this.locked) {
            this.showError('touch', 'Nessun set attivo: tocco non registrato')
            return null
        }
        this.newTouch.set = currentSet.id
        if(this.selectedPlayer)
            this.newTouch.player = this.selectedPlayer.id
        this.newTouch.fundamental = event.fundamental
        this.newTouch.outcome = event.outcome
        // if form is valid
        if((this.newTouch.fundamental != "") && (this.newTouch.outcome != "")) {
            const clientId = newClientId()
            this.sendTouch({ ...this.newTouch, client_id: clientId, seq: ++this.touchSeq, rally: this.rallySeq })
            this.newTouch = {id: -1, set: -1, player: -1, fundamental: '', outcome: ''}
            return clientId
        }
        return null
    }

    private sendTouch(touch: TrackedTouch): void {
        const { seq, rally, uncertain, ...payload } = touch
        this.pendingTouches = [...this.pendingTouches, touch]
        this.saveState() // an unsent touch survives a reload
        this.touchesService.createTouch({ ...payload, writer: this.writer }).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: (res) => {
                console.log(res)
                // The entry may have been re-tagged meanwhile (undo of a point): use its current rally
                const current = this.pendingTouches.find(t => t.client_id === touch.client_id) ?? touch
                this.pendingTouches = this.pendingTouches.filter(t => t.client_id !== touch.client_id)
                // A late answer for a set that is already over is saved but not shown
                if (touch.set === this.globalService.currentSet()?.id)
                    this.touches = [...this.touches, { ...res, seq, rally: current.rally }].sort((a, b) => a.seq - b.seq)
                this.clearError('touch')
                this.clearError('rally')
                this.refreshStatus()
                this.saveState()
                this.cdr.detectChanges()
            },
            error: (err) => {
                console.error('Errore salvataggio nuovo tocco', err)
                const current = this.pendingTouches.find(t => t.client_id === touch.client_id) ?? touch
                this.pendingTouches = this.pendingTouches.filter(t => t.client_id !== touch.client_id)
                this.failedTouches = [...this.failedTouches, { ...current, uncertain: current.uncertain || err?.name === 'TimeoutError' }]
                if (err?.status === 409) this.setReadOnly('La partita è terminata o aperta su un altro dispositivo: ricarica la pagina per riprenderla qui')
                this.refreshStatus()
                this.saveState()
                this.cdr.detectChanges()
            }
        });
    }

    // Safe to retry: the client_id makes the server return the touch if it already has it
    retryFailedTouches(): void {
        const toRetry = this.failedTouches
        this.failedTouches = []
        this.clearError('discard') // a re-sent touch is kept, so an earlier discard failure no longer applies
        toRetry.forEach(t => this.sendTouch(t))
        this.refreshStatus()
    }

    discardFailedTouches(): void {
        if (!confirm('Scartare i tocchi non salvati?')) return
        this.dropUnsaved(this.failedTouches)
    }

    private dropUnsaved(list: TrackedTouch[]): void {
        if (list.some(t => t.uncertain)) this.clearError('discard') // a new attempt replaces the old failure
        this.failedTouches = this.failedTouches.filter(t => !list.includes(t))
        list.filter(t => t.uncertain).forEach(t => this.removeUncertainTouch(t))
        // A touch never saved has no delete: take back its point here
        list.filter(t => !t.uncertain).sort((a, b) => b.seq - a.seq).forEach(t => this.revertPointOf(t.client_id))
        this.refreshStatus()
        this.updateSuggestion()
        this.saveState()
    }

    // A touch that timed out may exist on the server anyway: re-send it (same client_id,
    // so the server returns it instead of saving it twice) and delete what comes back
    private removeUncertainTouch(touch: TrackedTouch): void {
        const { seq, rally, uncertain, ...payload } = touch
        this.pendingDeletes++
        this.touchesService.createTouch({ ...payload, writer: this.writer }).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: (res) => {
                this.pendingDeletes--
                // If the delete fails, the touch goes back to the unsaved list so Scarta can try again
                this.deleteTouch({ ...res, seq, rally }, () => {
                    this.failedTouches = [...this.failedTouches, touch]
                }, 'discard')
            },
            error: (err) => {
                this.pendingDeletes--
                this.failedTouches = [...this.failedTouches, touch]
                this.refreshStatus()
                this.showError('discard', 'Tocco incerto non scartato: riprova più tardi', err)
            }
        })
    }

    // Status messages that only make sense while something is pending or unsaved
    private refreshStatus(): void {
        if (!this.busy) {
            this.clearError('busy')
            this.clearError('pending')
        }
        if (this.failedTouches.length === 0) this.clearError('unsaved')
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
        const chosen: Player[] = event.startingPlayers
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
    
    createSet(set: Set) {
        
        const lastResult = this.results.at(-1)
        if(lastResult && lastResult.home_score === 0 && lastResult.guest_score === 0 && this.setNumber != 1){  
            this.showError('set', 'Il set precedente è finito 0-0: nuovo set non creato')
            return
        }else if (!this.creatingSet){  
            this.creatingSet = true
            this.globalService.currentSet.set(null) // no touch can go to the old set meanwhile
            this.setsService.createSet(this.newSet).subscribe({
                next: (res) => {
                    this.creatingSet = false
                    this.clearError('set')
                    this.clearError('touch')
                    this.clearError('match')
                    this.globalService.currentSet.set(res);
                    this.cdr.detectChanges()
                    console.log(res)
                    this.resetVariables()
                },
                error: (err) => {
                    this.creatingSet = false
                    if (err?.status === 409) {
                        this.setReadOnly('La partita è terminata: non si possono aggiungere set')
                        return
                    }
                    this.showError('set', 'Set non creato: premi NUOVO SET per riprovare', err)
                }
            }); 
        }
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
        if(!currentSet || !currentSet.id){
            this.showError('set', 'Nessun set attivo da chiudere')
            return
        }
    
        const updatedScores = {
            home_score: this.score.home,
            guest_score: this.score.guests
        }
        this.endingSet = true
        this.setsService.updateSet(currentSet.id, updatedScores).subscribe({
            next: (res) => {
                console.log("Set aggiornato con i punteggi:", res)
                this.endingSet = false
                this.clearError('set')
                // Recorded only once the server has it, so a retry does not duplicate it
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
            },
            error: (err) => {
                this.endingSet = false
                this.showError('set', 'Punteggio del set non salvato: premi FINE SET per riprovare', err)
            }
        });
    }

    updateMatchResults(results: { home_score: number; guest_score: number }[]) {
        const match = this.globalService.currentMatch()
        if(!match || !match.id)
            this.showError('match', 'Nessuna partita a cui salvare i risultati')
        else
        this.matchesService.updateMatch(match.id, { results: results, live_state: null }).subscribe({
            next: (res) => {
                console.log("Risultati aggiornati:", res)
                try { localStorage.removeItem(STATE_KEY + match.id) } catch {}
                this.globalService.resetAll()
                this.router.navigate(['/'])
            },
            error: (err) => {
                this.endingMatch = false
                this.showError('match', 'Risultati della partita non salvati: premi FINE MATCH per riprovare', err)
            }
    })
    }

    // A set opened (NUOVO SET) but never played
    get currentSetUnstarted(): boolean {
        return this.hasActiveSet && !this.endSetClicked && this.score.home === 0 && this.score.guests === 0
            && this.touches.length === 0 && this.pendingTouches.length === 0
    }

    get canEndMatch(): boolean {
        return !this.endingMatch && !this.creatingSet && !this.endingSet && this.results.length > 0
            && (this.endSetClicked || this.currentSetUnstarted || !this.hasActiveSet)
    }

    confirmEndMatch() {
        if (this.failedTouches.length > 0) {
            this.showError('unsaved', 'Ci sono tocchi non salvati: premi Riprova o Scarta prima di terminare')
            return
        }
        if (this.busy || this.unsentRallies.length > 0 || this.unsentRallyDeletes.length > 0 || this.unsentEvents.length > 0) {
            this.showError('pending', 'Salvataggio in corso: attendi e premi di nuovo FINE MATCH')
            return
        }
        const emptySet = this.currentSetUnstarted ? ' Il set vuoto appena aperto verrà eliminato.' : ''
        if (!confirm(`Terminare la partita?${emptySet} Non potrai più registrare tocchi.`)) return
        this.endMatch()
    }

    // The last played set is already saved by FINE SET; an empty set opened by mistake is removed
    endMatch() {
        this.endingMatch = true
        clearTimeout(this.saveTimer) // a late live-state save must not bring the match back
        this.saveTimer = null
        const current = this.globalService.currentSet()
        if (!this.endSetClicked && current?.id) {
            this.setsService.deleteSet(current.id).subscribe({
                next: () => this.afterEmptySetRemoved(),
                error: (err) => {
                    if (err?.status === 404) {
                        this.afterEmptySetRemoved()
                        return
                    }
                    this.endingMatch = false
                    this.showError('match', 'Set vuoto non eliminato: premi FINE MATCH per riprovare', err)
                }
            })
        } else {
            this.updateMatchResults(this.results)
        }
    }

    private afterEmptySetRemoved(): void {
        this.globalService.currentSet.set(null)
        this.endSetClicked = true // back to the state after the last FINE SET, in case saving the results fails
        this.updateMatchResults(this.results)
    }
}