import { ChangeDetectorRef, Component, inject, Input, TemplateRef, ViewChild } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { forkJoin } from 'rxjs'
import { KpiRow, RallyStats, StatsService } from '../../../services/statsService'
import { KpiViewComponent } from '../../shared/kpiView/kpiView.component'

// KPI of the current set or of the whole match, readable during a time-out.
// Opens over the game, so the live state is kept.
@Component({
    selector: 'app-stats-panel',
    standalone: true,
    imports: [KpiViewComponent],
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

    scope: 'set' | 'match' = 'set'
    rows: KpiRow[] = []
    rallies: RallyStats | null = null
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
        this.rallies = null
        if (!id) {
            this.loading = false
            this.error = this.scope === 'set' ? 'Nessun set attivo' : 'Nessuna partita attiva'
            return
        }
        this.loading = true
        this.error = ''
        const kpi = this.scope === 'set' ? this.statsService.getSetKpi(id) : this.statsService.getMatchKpi(id)
        const rallies = this.scope === 'set' ? this.statsService.getSetRallyStats(id) : this.statsService.getMatchRallyStats(id)
        forkJoin({ rows: kpi, rallies }).subscribe({
            next: ({ rows, rallies }) => {
                if (request !== this.request) return
                this.rows = rows
                this.rallies = rallies
                this.loading = false
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
}
