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
import { forkJoin, switchMap, timeout } from 'rxjs'
import {
    afterPoint, DEFAULT_FORMAT, MatchFormat, matchWinner, serverIndex, setsWon, setWinner,
    sideSwitchDue, suggestFundamental, Team, terminalWinner,
} from './rallyEngine'

// A touch as tracked on this page: tap order and rally are fixed when the scout taps.
// uncertain: the request timed out, so the server may have saved it anyway.
type TrackedTouch = Touch & { seq: number; rally: number; uncertain?: boolean }

const REQUEST_TIMEOUT_MS = 15000
const STATE_KEY = 'matchvision.live.' // + match id, local copy of the live state

// Everything needed to resume a match that is being scouted (touches are on the server already)
interface LiveState {
    v: 1
    savedAt: number
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
}

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
    private lastAutoPoint: { touchSeq: number; prev: { home: number; guests: number; serving: Team; rotation: number; rallySeq: number } } | null = null
    info: string = ''
    private infoTimer: any = null
    private autoSelected: Player | null = null // the server preselected by the app, not by the scout

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
    leftTimeOuts: number = 3
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

    private get matchId(): number | null {
        return this.globalService.currentMatch()?.id || null
    }

    private buildState(): LiveState {
        return {
            v: 1,
            savedAt: Date.now(),
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
        }
    }

    saveState(): void {
        const id = this.matchId
        if (!id || this.endingMatch || this.resuming) return
        const state = this.buildState()
        try { localStorage.setItem(STATE_KEY + id, JSON.stringify(state)) } catch {}
        clearTimeout(this.saveTimer)
        this.saveTimer = setTimeout(() => this.pushState(id, state), 800)
    }

    private pushState(id: number, state: LiveState): void {
        this.saveTimer = null
        if (this.endingMatch) return
        this.matchesService.updateMatch(id, { live_state: state }).subscribe({
            next: () => this.clearError('snapshot'),
            error: (err) => this.showError('snapshot', 'Stato della partita non salvato sul server: la ripresa da un altro dispositivo potrebbe non essere aggiornata', err),
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
                // The newest between the local copy and the server copy
                const local = this.readLocalState(id)
                const server = match.live_state as LiveState | null
                const state = [local, server].filter((s): s is LiveState => !!s && s.v === 1).sort((a, b) => b.savedAt - a.savedAt)[0]
                if (!state) {
                    this.resuming = false
                    if (sets.length === 0) {
                        this.startNewSet() // created but never started
                    } else {
                        this.showError('match', 'Questa partita non ha uno stato salvato e non può essere ripresa: aprila da Partite → Dettagli')
                    }
                    return
                }
                this.applyState(state, players)
                const set = sets.find(s => s.id === state.setId) ?? null
                this.globalService.currentSet.set(set)
                if (!set) {
                    this.finishResume()
                    return
                }
                this.touchesService.getSetTouches(set.id).subscribe({
                    next: (touches) => {
                        // Earlier rallies: palla contesa only works on rallies recorded after the resume
                        this.touches = touches.map(t => ({ ...t, seq: ++this.touchSeq, rally: -1 }))
                        this.finishResume()
                    },
                    error: (err) => {
                        this.showError('resume', 'Tocchi del set non caricati: undo non disponibile per i tocchi precedenti', err)
                        this.finishResume()
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
        this.rallySeq = 0
    }

    private finishResume(): void {
        this.resuming = false
        this.updateSuggestion()
        this.showInfo('Partita ripresa')
        this.saveState()
        this.cdr.detectChanges()
    }

    // Leaving clears the global match state; "Riprendi scout" reloads it from the server
    ngOnDestroy(): void {
        clearTimeout(this.infoTimer)
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

    // "−" = correction of the score only (serve and rotation are not touched)
    decreaseScore(team: Team) {
        if (this.score[team] > 0) this.score[team]--
        this.lastAutoPoint = null
        this.closeRally()
        this.updateSuggestion()
        this.saveState()
    }

    private awardPoint(winner: Team, cause: string = '', auto: boolean = false): void {
        if (!auto) this.lastAutoPoint = null
        this.score[winner]++
        const next = afterPoint({ serving: this.serving, rotation: this.rotation }, winner)
        this.serving = next.serving
        this.rotation = next.rotation
        this.closeRally()
        if (cause) this.showInfo(`Punto ${winner === 'home' ? 'CASA' : 'OSPITI'} (${cause})${next.rotated ? ' · rotazione' : ''}`)
        if (!this.sideSwitched && sideSwitchDue(this.score, this.setNumber, this.format)) {
            this.sideSwitched = true
            this.togglePos()
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

    // Who serves: chosen at the start of the set, can be corrected at any time (no rotation)
    setServing(team: Team): void {
        if (this.endSetClicked) return
        if (this.score.home === 0 && this.score.guests === 0) this.firstServer = team
        this.serving = team
        this.lastAutoPoint = null
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
        if (rally.length === 0 && this.serving === 'home' && this.starting_players.length === 6 && !this.endSetClicked) {
            this.selectedPlayer = this.starting_players[this.serverIdx]
            this.autoSelected = this.selectedPlayer
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

    // Undoing the touch that scored also takes back its point, serve and rotation
    private revertAutoPoint(): void {
        const p = this.lastAutoPoint?.prev
        if (!p) return
        this.score.home = p.home
        this.score.guests = p.guests
        this.serving = p.serving
        this.rotation = p.rotation
        this.rallySeq = p.rallySeq
        this.lastAutoPoint = null
        this.showInfo('Punto annullato')
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
        return this.touches.length > 0 && this.pendingTouches.length === 0 && this.pendingDeletes === 0 && !this.endSetClicked
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
        this.selectedPlayer = this.selectedOnCourt?.id === player.id ? null : player
        this.autoSelected = null
    }

    // The selection counts only while that player is on court: a substitution, a libero swap,
    // a new lineup or a new set make it void
    get selectedOnCourt(): Player | null {
        const p = this.selectedPlayer
        if (!p) return null
        return this.starting_players.some(s => s.id === p.id) || this.libero?.id === p.id ? p : null
    }

    onTouchEntered(event: {fundamental: string; outcome: string}): void {
        if (!this.selectedOnCourt) {
            this.selectedPlayer = null
            this.showError('touch', 'Tocca prima un giocatore in campo')
            return
        }
        const prev = { home: this.score.home, guests: this.score.guests, serving: this.serving, rotation: this.rotation, rallySeq: this.rallySeq }
        const sent = this.registerNewTouch(event)
        this.selectedPlayer = null
        if (!sent) return
        const winner = terminalWinner(event.fundamental, event.outcome)
        if (winner) {
            this.lastAutoPoint = { touchSeq: this.touchSeq, prev }
            this.awardPoint(winner, `${event.fundamental} ${event.outcome}`, true)
        } else {
            this.updateSuggestion()
        }
    }

    openStats(): void { this.statsPanel.open() }

    get statsSetLabel(): string {
        const set = this.globalService.currentSet()
        return set?.number ? `Set ${set.number}` : 'Set'
    }

    // Change players
    openChangePlayersModal(): void { this.changePlayersModal.open() }

    openNewEventModal(): void {
        this.eventOccurred.event_type = '' // no leftover choice from a closed modal
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
        this.saveState()
    }

    onChange(double: boolean): void {
        if (double) {
            if (this.doubleChangeCounter > 0) this.doubleChangeCounter--
        } else if (this.changeCounter > 0) this.changeCounter--
        this.onLineupChanged()
    }
    
    togglePos(): void {
        this.index = this.index === 0 ? 1 : 0
        this.saveState()
        this.cdr.detectChanges()
    }

    
    registerNewEvent(): void {
        switch(this.eventOccurred.event_type) {
            case EventType.TECHNICAL_TIMEOUT:
                if(this.leftTimeOuts > 0)
                    this.leftTimeOuts--
                break
            case EventType.YELLOW_CARD:
                this.y_card_counter++
                break
            case EventType.RED_CARD:
                this.r_card_counter++
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
        if (this.lastAutoPoint?.touchSeq === touch.seq) this.revertAutoPoint()
        this.updateSuggestion()
        console.log('Tocco eliminato', touch.id)
        this.clearError(key)
        this.refreshStatus()
        this.cdr.detectChanges()
    }

    // Create new touch
    registerNewTouch(event: {fundamental: string; outcome: string}): boolean {
        const currentSet = this.globalService.currentSet()
        if(!currentSet || !currentSet.id || this.endSetClicked) {
            this.showError('touch', 'Nessun set attivo: tocco non registrato')
            return false
        }
        this.newTouch.set = currentSet.id
        if(this.selectedPlayer)
            this.newTouch.player = this.selectedPlayer.id
        this.newTouch.fundamental = event.fundamental
        this.newTouch.outcome = event.outcome
        // if form is valid
        if((this.newTouch.fundamental != "") && (this.newTouch.outcome != "")) {
            this.sendTouch({ ...this.newTouch, client_id: newClientId(), seq: ++this.touchSeq, rally: this.rallySeq })
            this.newTouch = {id: -1, set: -1, player: -1, fundamental: '', outcome: ''}
            return true
        }
        return false
    }

    private sendTouch(touch: TrackedTouch): void {
        const { seq, rally, uncertain, ...payload } = touch
        this.pendingTouches = [...this.pendingTouches, touch]
        this.touchesService.createTouch(payload).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: (res) => {
                console.log(res)
                this.pendingTouches = this.pendingTouches.filter(t => t !== touch)
                // A late answer for a set that is already over is saved but not shown
                if (touch.set === this.globalService.currentSet()?.id)
                    this.touches = [...this.touches, { ...res, seq, rally }].sort((a, b) => a.seq - b.seq)
                this.clearError('touch')
                this.clearError('rally')
                this.refreshStatus()
                this.cdr.detectChanges()
            },
            error: (err) => {
                console.error('Errore salvataggio nuovo tocco', err)
                this.pendingTouches = this.pendingTouches.filter(t => t !== touch)
                this.failedTouches = [...this.failedTouches, { ...touch, uncertain: touch.uncertain || err?.name === 'TimeoutError' }]
                this.refreshStatus()
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
        this.refreshStatus()
    }

    // A touch that timed out may exist on the server anyway: re-send it (same client_id,
    // so the server returns it instead of saving it twice) and delete what comes back
    private removeUncertainTouch(touch: TrackedTouch): void {
        const { seq, rally, uncertain, ...payload } = touch
        this.pendingDeletes++
        this.touchesService.createTouch(payload).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
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
        this.rotation = (this.rotation + 1) % 6
        this.lastAutoPoint = null
        this.updateSuggestion()
        this.saveState()
    }

    playerPos(i: number): [number, number] {
        return this.pos[this.index][(i - this.rotation + 6) % 6]
    }

    assignPlayers(event: any) {
        this.selectedPlayer = null
        this.starting_players = event.startingPlayers
        this.libero = event.libero
        this.bench_players = event.benchPlayers
        this.bench_libero = event.benchLibero
        this.updateSuggestion()
        this.saveState()
    }

    startNewSet(){
        if (this.endingMatch) return
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
        this.lastAutoPoint = null
        this.sideSwitched = false
        if (this.setNumber > 1) {
            // New set: the teams change court and the other team serves first
            this.firstServer = this.firstServer === 'home' ? 'guests' : 'home'
            this.index = this.index === 0 ? 1 : 0
        }
        this.serving = this.firstServer

        this.changeCounter = 6
        this.doubleChangeCounter = 2
        this.leftTimeOuts = 3
        this.y_card_counter = 0
        this.r_card_counter = 0

        this.endSetClicked = false
        this.clearError('locked')
        this.updateSuggestion()
        this.saveState()

        this.cdr.detectChanges()
    }

    handleNextSet() {
        if (this.setNumber < 5) {
            this.setNumber = this.setNumber + 1
        } else {
            this.allSetsPlayed = true
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
                this.lastAutoPoint = null
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
        if (this.busy) {
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