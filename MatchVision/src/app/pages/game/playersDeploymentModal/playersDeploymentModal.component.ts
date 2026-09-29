import { Component, EventEmitter, inject, Output, TemplateRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { Player, Role } from '../../../Models/Player';

// The app stores roles as the Italian labels of the form ('Centrale'); the enum has the English codes
function isMiddleBlocker(p: Player): boolean {
    return (p.role as string) === 'Centrale' || p.role === Role.MIDDLE_BLOCKER
}
import { GlobalService } from '../../../services/globalService';

@Component({
    selector: 'app-players-deployment-modal',
    standalone: true,
    imports: [
        FormsModule,
    ],
    templateUrl: './playersDeploymentModal.component.html',
    styleUrls: ['./playersDeploymentModal.component.scss']
})

export class PlayersDeploymentModal {
    
    constructor(private globalService: GlobalService) {}
   
    private modalService = inject(NgbModal)

    @ViewChild('content', { static: true }) content!: TemplateRef<any>
    
    @Output() startingPlayersChosen = new EventEmitter<any>()

    startingPlayers: Player[] = []
    libero: Player | null = null
    benchLibero: Player | null = null
    benchPlayers: Player[] = []
    liberoFor: number[] = [] // starters the libero replaces in the back row (usually the middle blockers)

    // Read at every use: after a resume the players arrive later than this component
    get allPlayers(): Player[] {
        return this.globalService.currentPlayers()
    }

    // The starters, without whoever is picked as libero (a libero cannot be in the six)
    get availablePlayersForStart(): Player[] {
        return this.allPlayers.filter(p => !this.isLiberoSelected(p) && !this.isBenchLiberoSelected(p))
    }

    // Position of a starter: the tap order becomes I (server), II, ... VI
    positionOf(player: Player): string {
        const i = this.startingPlayers.findIndex(p => p.id === player.id)
        return i < 0 ? '' : ['I', 'II', 'III', 'IV', 'V', 'VI'][i]
    }

    open() {
        this.modalService.open(this.content, { ariaLabelledBy: 'modal-players-deployment', size: 'lg'})
    }

    get availablePlayersForLibero(): Player[] {
        return this.allPlayers.filter(p => 
            !this.isStartingPlayerSelected(p)
        )
    }

    get availablePlayersForBench(): Player[] {
        return this.allPlayers.filter(p => 
            !this.isStartingPlayerSelected(p) && !this.isLiberoSelected(p)
        )
    }

    toggleStartingPlayer(player: Player): void {
        const index = this.startingPlayers.findIndex(p => p.id === player.id)
        if (index > -1) {
            this.startingPlayers.splice(index, 1)
        } else {
            if (this.startingPlayers.length < 6) {
                this.startingPlayers.push(player)
            }
        }
    }

    toggleLibero(player: Player): void {
        if (this.isStartingPlayerSelected(player)) return
        if (this.libero && this.libero.id === player.id) {
            this.libero = null
            this.liberoFor = []
        } else {
            this.libero = player
            // By default the libero comes in for the two middle blockers opposite each other
            if (this.liberoFor.length === 0) {
                const middles = this.startingPlayers.filter(p => isMiddleBlocker(p))
                this.liberoFor = middles.length === 2 && this.areOpposite(middles[0], middles[1])
                    ? middles.map(p => p.id)
                    : middles.slice(0, 1).map(p => p.id)
            }
        }
    }

    // At most two, normally opposite in the lineup (never in the back row together)
    toggleLiberoFor(player: Player): void {
        if (this.liberoFor.includes(player.id)) this.liberoFor = this.liberoFor.filter(id => id !== player.id)
        else if (this.liberoFor.length < 2) this.liberoFor = [...this.liberoFor, player.id]
    }

    areOpposite(a: Player, b: Player): boolean {
        const i = this.startingPlayers.findIndex(p => p.id === a.id)
        const j = this.startingPlayers.findIndex(p => p.id === b.id)
        return i >= 0 && j >= 0 && Math.abs(i - j) === 3
    }

    get liberoWarning(): string {
        if (this.liberoFor.length !== 2) return ''
        const [a, b] = this.liberoFor.map(id => this.startingPlayers.find(p => p.id === id)!)
        return a && b && !this.areOpposite(a, b)
            ? 'I due giocatori non sono opposti: quando sono entrambi in seconda linea il libero sostituisce solo il primo'
            : ''
    }

    toggleBenchLibero(player: Player): void {
        if (this.isStartingPlayerSelected(player)) return
        if (this.benchLibero && this.benchLibero.id === player.id) {
            this.benchLibero = null
        } else {
            this.benchLibero = player
        }
    }

    isStartingPlayerSelected(player: Player): boolean {
        return this.startingPlayers.some(p => p.id === player.id)
    }
    
    isLiberoSelected(player: Player): boolean {
        return this.libero?.id === player.id
    }
    
    isBenchLiberoSelected(player: Player): boolean {
        return this.benchLibero?.id === player.id
    }
    
    confirm(): void {
        if (this.startingPlayers.length !== 6) {
            alert('Devi selezionare esattamente 6 giocatori titolari.')
            return
        }

        this.benchPlayers = this.allPlayers.filter(p =>
            !this.isStartingPlayerSelected(p) &&
            !this.isLiberoSelected(p) &&
            !this.isBenchLiberoSelected(p)
        )
        
        console.log('Titolari:', this.startingPlayers)
        console.log('Libero:', this.libero)
        console.log('Libero di riserva:', this.benchLibero)
        console.log('Panchinari:', this.benchPlayers)
        
        const liberoFor = this.libero ? this.liberoFor.filter(id => this.startingPlayers.some(p => p.id === id)) : []
        this.startingPlayersChosen.emit({ startingPlayers: this.startingPlayers, libero: this.libero, benchLibero: this.benchLibero, benchPlayers: this.benchPlayers, liberoFor })

        this.startingPlayers = []
        this.libero = null
        this.benchLibero = null
        this.benchPlayers = []
        this.liberoFor = []
    }


}