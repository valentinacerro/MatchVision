import { ChangeDetectorRef, Component, HostListener, OnInit, ViewChild } from '@angular/core'
import { Router, RouterModule } from '@angular/router'

import { ChangePlayersModalComponent } from "./changePlayersModal/changePlayersModal.component"
import { NewTouchModalComponent } from "./newTouchModal/newTouchModal.component"
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

@Component({
    selector: 'app-game',
    standalone: true,
    imports: [
        RouterModule,
        ChangePlayersModalComponent,
        NewTouchModalComponent,
        NewEventModalComponent,
        PlayersDeploymentModal
    ],
    templateUrl: './game.html',
    styleUrls: ['./game.scss']
})

export class GameComponent implements OnInit{

    constructor(private touchesService: TouchesService,
        private setsService: SetsService,
        private matchesService: MatchesService,
        public globalService: GlobalService,
        private router: Router,
        private cdr: ChangeDetectorRef) {}

    @ViewChild(ChangePlayersModalComponent) changePlayersModal!: ChangePlayersModalComponent
    @ViewChild(NewTouchModalComponent) newTouchModal!: NewTouchModalComponent
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
    touches: Touch[] = []
    pendingSaves: number = 0 // touches sent but not confirmed yet
    pendingDeletes: number = 0
    rallyStartIndex: number = 0 // first touch after the last point
    errorMessage: string = ''

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
    isEndOfMatch: boolean = false
    endingMatch: boolean = false
    
    ngOnInit(): void {
        this.players = this.globalService.currentPlayers()
        const currentMatch = this.globalService.currentMatch()
        console.log("dati partita corrente", currentMatch)
        this.startNewSet()
    }

    // A score change closes the rally in progress
    increaseScore(team: 'home' | 'guests') {
        this.score[team]++
        this.rallyStartIndex = this.touches.length
    }

    decreaseScore(team: 'home' | 'guests') {
        if (this.score[team] > 0) this.score[team]--
        this.rallyStartIndex = this.touches.length
    }

    get lastTouchText(): string {
        const last = this.touches.at(-1)
        if (!last) return ''
        const player = [...this.players, ...this.starting_players].find(p => p.id === last.player)
        return `${player ? '#' + player.number + ' ' : ''}${last.fundamental} ${last.outcome}`
    }

    get canUndo(): boolean {
        return this.touches.length > 0 && this.pendingSaves === 0 && this.pendingDeletes === 0
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
        return !this.gameInProgress || confirm('La partita è in corso: se esci non potrai riprenderla. Uscire comunque?')
    }

    // Errors stay on screen until dismissed, so a lost touch is never silent
    showError(message: string, err?: any): void {
        if (err) console.error(message, err)
        this.errorMessage = message
        this.cdr.detectChanges()
    }


    // Inserting a new touch for the player
    openNewTouchModal() { this.newTouchModal.open() }

    // Change players
    openChangePlayersModal(): void { this.changePlayersModal.open() }

    openNewEventModal(): void { this.newEventModal.open() }

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
        if (this.pendingSaves > 0 || this.pendingDeletes > 0) {
            this.showError('Salvataggio in corso, riprova tra un attimo')
            return
        }
        const rallyTouches = this.touches.slice(Math.min(this.rallyStartIndex, this.touches.length))
        if (rallyTouches.length === 0) return
        if (!confirm(`Palla contesa: annullare i ${rallyTouches.length} tocchi del rally in corso?`)) return
        rallyTouches.forEach(t => this.deleteTouch(t))
    }

    // Delete last touch
    undoLastTouch(): void {
        const last = this.touches.at(-1)
        if (last && this.canUndo) this.deleteTouch(last)
    }

    deleteTouch(touch: Touch): void {
        this.pendingDeletes++
        this.touchesService.deleteTouch(touch.id).subscribe({
            next: () => {
                this.pendingDeletes--
                this.touches = this.touches.filter(t => t.id !== touch.id)
                this.rallyStartIndex = Math.min(this.rallyStartIndex, this.touches.length)
                console.log('Tocco eliminato', touch.id)
                this.cdr.detectChanges()
            },
            error: (err) => {
                this.pendingDeletes--
                this.showError('Tocco non eliminato: riprova', err)
            }
        })
    }

    // Create new touch
    registerNewTouch(event: {fundamental: string; outcome: string}): void {
        const currentSet = this.globalService.currentSet()
        if(!currentSet || !currentSet.id) {
            this.showError('Nessun set attivo: tocco non registrato')
            return
        }
        this.newTouch.set = currentSet.id
        if(this.selectedPlayer)
            this.newTouch.player = this.selectedPlayer.id
        this.newTouch.fundamental = event.fundamental
        this.newTouch.outcome = event.outcome
        // if form is valid
        if((this.newTouch.fundamental != "") && (this.newTouch.outcome != "")) {
            this.pendingSaves++
            this.touchesService.createTouch(this.newTouch).subscribe({
                next: (res) => {
                    console.log(res)
                    this.pendingSaves--
                    this.touches.push(res)
                    this.cdr.detectChanges()
                },
                error: (err) => {
                    this.pendingSaves--
                    this.showError(`Tocco NON salvato (${event.fundamental} ${event.outcome}): registralo di nuovo`, err)
                }
            });
            this.newTouch = {id: -1, set: -1, player: -1, fundamental: '', outcome: ''}
        }
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
        const currentMatch = this.globalService.currentMatch()
        if (!currentMatch || !currentMatch.id) {
            this.showError('Nessuna partita attiva: torna alle partite e creane una')
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
        
        if((this.score.home === 0 && this.score.guests === 0) && this.setNumber != 1){  
            this.showError('Il set precedente è finito 0-0: nuovo set non creato')
            return
        }else if (!this.creatingSet){  
            this.creatingSet = true
            this.setsService.createSet(this.newSet).subscribe({
                next: (res) => {
                    this.creatingSet = false
                    this.globalService.currentSet.set(res);
                    this.cdr.detectChanges()
                    console.log(res)
                    this.resetVariables()
                },
                error: (err) => {
                    this.creatingSet = false
                    this.showError('Set non creato: riprova', err)
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
        this.rallyStartIndex = 0
        this.score.guests = 0
        this.score.home = 0
        this.rotation = 0

        this.changeCounter = 6
        this.doubleChangeCounter = 2
        this.leftTimeOuts = 3
        this.y_card_counter = 0
        this.r_card_counter = 0

        this.isEndOfMatch = false
        this.endSetClicked = false

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
        if (!confirm(`Chiudere il set ${this.setNumber} sul ${this.score.home}-${this.score.guests}?`)) return
        this.endSet()
    }

    endSet() {
        // Update set
        const currentSet = this.globalService.currentSet()
        if(!currentSet || !currentSet.id){
            this.showError('Nessun set attivo da chiudere')
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
                if(!this.isEndOfMatch){
                    // Recorded only once the server has it, so a retry does not duplicate it
                    this.results = [...this.results, updatedScores]
                    this.endSetClicked = true
                    this.handleNextSet()
                }
            },
            error: (err) => {
                this.endingSet = false
                this.showError('Punteggio del set non salvato: riprova', err)
            }
        });
    }

    updateMatchResults(results: { home_score: number; guest_score: number }[]) {
        const match = this.globalService.currentMatch()
        if(!match || !match.id)
            this.showError('Nessuna partita a cui salvare i risultati')
        else
        this.matchesService.updateMatch(match.id, { results: results }).subscribe({
            next: (res) => {
                console.log("Risultati aggiornati:", res)
                this.globalService.resetAll()
                this.router.navigate(['/'])
            },
            error: (err) => {
                this.isEndOfMatch = false
                this.endingMatch = false
                this.showError('Risultati della partita non salvati: riprova', err)
            }
    })
    }

    confirmEndMatch() {
        if (!confirm('Terminare la partita? Non potrai più registrare tocchi.')) return
        this.endMatch()
    }

    endMatch() {
        this.isEndOfMatch = true
        this.endingMatch = true
        this.endSet()
        this.updateMatchResults(this.results)
    }
}