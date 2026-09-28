import { ChangeDetectorRef, Component, inject, Input, TemplateRef, ViewChild } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { KpiRow, StatsService } from '../../../services/statsService'
import { ALL_FUNDAMENTALS } from '../touchPad/touchPad.component'

// KPI of the current set or of the whole match, readable during a time-out.
// Opens over the game, so the live state is kept.
@Component({
    selector: 'app-stats-panel',
    standalone: true,
    templateUrl: './statsPanel.component.html',
    styleUrls: ['./statsPanel.component.scss']
})
export class StatsPanelComponent {

    private modalService = inject(NgbModal)
    private statsService = inject(StatsService)
    private cdr = inject(ChangeDetectorRef)
    @ViewChild('content', { static: true }) content!: TemplateRef<any>

    @Input() matchId: number | null = null
    @Input() setId: number | null = null
    @Input() setLabel: string = 'Set'

    readonly grades: (keyof KpiRow)[] = ['++', '+', '!', '—', '— —']

    scope: 'set' | 'match' = 'set'
    rows: KpiRow[] = []
    fundamental = 'Ricezione'
    loading = false
    error = ''
    private request = 0 // only the latest answer is shown

    open(): void {
        this.modalService.open(this.content, { size: 'xl', scrollable: true, ariaLabelledBy: 'modal-stats' })
        this.load()
    }

    setScope(scope: 'set' | 'match'): void {
        this.scope = scope
        this.load()
    }

    load(): void {
        const id = this.scope === 'set' ? this.setId : this.matchId
        const request = ++this.request
        this.rows = []
        if (!id) {
            this.loading = false
            this.error = this.scope === 'set' ? 'Nessun set attivo' : 'Nessuna partita attiva'
            return
        }
        this.loading = true
        this.error = ''
        const kpi = this.scope === 'set' ? this.statsService.getSetKpi(id) : this.statsService.getMatchKpi(id)
        kpi.subscribe({
            next: (rows) => {
                if (request !== this.request) return
                this.rows = rows
                this.loading = false
                const available = this.availableFundamentals
                if (available.length > 0 && !available.includes(this.fundamental)) this.fundamental = available[0]
                this.cdr.detectChanges()
            },
            error: (err) => {
                if (request !== this.request) return
                console.error('Errore caricamento statistiche', err)
                this.loading = false
                this.error = 'Statistiche non caricate: premi Aggiorna'
                this.cdr.detectChanges()
            }
        })
    }

    get availableFundamentals(): string[] {
        return ALL_FUNDAMENTALS.filter(f => this.rows.some(r => r.fundamental === f))
    }

    get visibleRows(): KpiRow[] {
        return this.rows.filter(r => r.fundamental === this.fundamental)
    }
}
