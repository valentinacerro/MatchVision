import { Component, Input, inject, TemplateRef, ViewChild, Output, EventEmitter } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { Player } from '../../../Models/Player'

// Picks who leaves and who enters; the game checks the substitution rules and applies it.
// Players are paired in the order they are tapped: the 1st leaving with the 1st entering, ...
@Component({
    selector: 'app-change-players-modal',
    standalone: true,
    imports: [],
    templateUrl: './changePlayersModal.component.html',
    styleUrl: './changePlayersModal.component.scss',
})
export class ChangePlayersModalComponent {
    private modalService = inject(NgbModal)
    @ViewChild('content', { static: true }) content!: TemplateRef<any>

    @Input() starting_players!: Player[]
    @Input() bench_players!: Player[]
    @Input() libero!: Player | null
    @Input() bench_libero!: Player | null
    @Input() changesLeft: number = 6

    @Output() changeRequested = new EventEmitter<{ out: Player[]; in: Player[]; exceptional: boolean }>()
    @Output() swapLiberosClicked = new EventEmitter<void>()

    enteringPlayers: Player[] = []
    exitingPlayers: Player[] = []
    exceptional = false // injury: FIVB 15.7, outside the normal substitution rules

    open() {
        this.exitingPlayers = []
        this.enteringPlayers = []
        this.exceptional = false
        this.modalService.open(this.content, { ariaLabelledBy: 'modal-change-players', size: 'lg' })
    }

    // Tap to select, tap again to deselect; at most two per side (a double change)
    toggle(list: Player[], player: Player): void {
        const i = list.findIndex(p => p.id === player.id)
        if (i >= 0) list.splice(i, 1)
        else if (list.length < 2) list.push(player)
    }

    orderOf(list: Player[], player: Player): number {
        return list.findIndex(p => p.id === player.id) + 1
    }

    get canConfirm(): boolean {
        return this.exitingPlayers.length > 0 && this.exitingPlayers.length === this.enteringPlayers.length
    }

    confirm(modal: any): void {
        if (!this.canConfirm) return
        this.changeRequested.emit({ out: [...this.exitingPlayers], in: [...this.enteringPlayers], exceptional: this.exceptional })
        modal.close()
    }

    changeLiberos(): void {
        this.swapLiberosClicked.emit()
    }
}
