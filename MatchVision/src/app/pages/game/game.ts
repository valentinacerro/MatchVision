import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { Router, RouterModule } from '@angular/router'

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
import { timeout } from 'rxjs'

// A touch as tracked on this page: tap order and rally are fixed when the scout taps.
// uncertain: the request timed out, so the server may have saved it anyway.
type TrackedTouch = Touch & { seq: number; rally: number; uncertain?: boolean }

const REQUEST_TIMEOUT_MS = 15000

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
        this.players = this.globalService.currentPlayers()
        const currentMatch = this.globalService.currentMatch()
        console.log("dati partita corrente", currentMatch)
        this.startNewSet()
    }

    // A left match cannot be resumed: forget it, so coming back does not reuse its sets
    ngOnDestroy(): void {
        this.globalService.resetAll()
    }

    // A score change closes the rally in progress
    increaseScore(team: 'home' | 'guests') {
        this.score[team]++
        this.closeRally()
    }

    decreaseScore(team: 'home' | 'guests') {
        if (this.score[team] > 0) this.score[team]--
        this.closeRally()
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

    @HostListener('window:beforeunload', ['$event'])
    onBeforeUnload(event: BeforeUnloadEvent): void {
        if (this.gameInProgress) {
            event.preventDefault()
            event.returnValue = ''
        }
    }

    canLeave(): boolean {
        if (!this.gameInProgress) return true
        const n = this.failedTouches.length
        const unsaved = n > 0 ? (n === 1 ? ' 1 tocco non salvato andrà perso.' : ` ${n} tocchi non salvati andranno persi.`) : ''
        return confirm(`La partita è in corso: se esci non potrai riprenderla.${unsaved} Uscire comunque?`)
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
        this.selectedPlayer = this.selectedPlayer?.id === player.id ? null : player
    }

    onTouchEntered(event: {fundamental: string; outcome: string}): void {
        this.registerNewTouch(event)
        this.selectedPlayer = null
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
        this.bench_libero = temp }
    
    togglePos(): void {
        this.index = this.index === 0 ? 1 : 0
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
        console.log('Tocco eliminato', touch.id)
        this.clearError(key)
        this.refreshStatus()
        this.cdr.detectChanges()
    }

    // Create new touch
    registerNewTouch(event: {fundamental: string; outcome: string}): void {
        const currentSet = this.globalService.currentSet()
        if(!currentSet || !currentSet.id || this.endSetClicked) {
            this.showError('touch', 'Nessun set attivo: tocco non registrato')
            return
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
        }
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

    // Rotation of players: the player in position 2 goes to 1, 1 goes to 6, ...
    doRotation(): void {
        this.rotation = (this.rotation + 1) % 6
    }

    playerPos(i: number): [number, number] {
        return this.pos[this.index][(i - this.rotation + 6) % 6]
    }

    assignPlayers(event: any) {
        this.starting_players = event.startingPlayers
        this.libero = event.libero
        this.bench_players = event.benchPlayers
        this.bench_libero = event.benchLibero
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

        this.starting_players = []
        this.libero = null
        this.bench_libero = null
        this.bench_players  = []

        this.touches = []
        this.rallySeq++
        this.score.guests = 0
        this.score.home = 0
        this.rotation = 0

        this.changeCounter = 6
        this.doubleChangeCounter = 2
        this.leftTimeOuts = 3
        this.y_card_counter = 0
        this.r_card_counter = 0

        this.endSetClicked = false
        this.clearError('locked')

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
                this.handleNextSet()
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
        this.matchesService.updateMatch(match.id, { results: results }).subscribe({
            next: (res) => {
                console.log("Risultati aggiornati:", res)
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