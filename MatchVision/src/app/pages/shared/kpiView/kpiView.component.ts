import { Component, Input, OnChanges } from '@angular/core'
import { KpiRow, RallyStats } from '../../../services/statsService'

export const FUNDAMENTALS_IN_PLAY_ORDER = ['Battuta', 'Ricezione', 'Alzata', 'Attacco', 'Muro', 'Difesa']
const ROTATIONS = 'Rotazioni'

// Statistics tables (KPI per player and fundamental, side-out / break-point per rotation).
// Presentation only: the data comes from the time-out panel or from the match details page.
@Component({
    selector: 'app-kpi-view',
    standalone: true,
    templateUrl: './kpiView.component.html',
    styleUrls: ['./kpiView.component.scss']
})
export class KpiViewComponent implements OnChanges {

    @Input() rows: KpiRow[] = []
    @Input() rallies: RallyStats | null = null

    readonly grades: (keyof KpiRow)[] = ['++', '+', '!', '—', '— —']
    readonly ROTATIONS = ROTATIONS
    view = 'Ricezione' // a fundamental, or ROTATIONS

    ngOnChanges(): void {
        // Keep the chosen view if it still has data, otherwise show the first one available
        const available = [...this.availableFundamentals, ...(this.rallies?.rotations?.length ? [ROTATIONS] : [])]
        if (available.length > 0 && !available.includes(this.view)) this.view = available[0]
    }

    get availableFundamentals(): string[] {
        return FUNDAMENTALS_IN_PLAY_ORDER.filter(f => this.rows.some(r => r.fundamental === f))
    }

    get visibleRows(): KpiRow[] {
        return this.rows.filter(r => r.fundamental === this.view)
    }

    pct(value: number | null | undefined): string {
        return value === null || value === undefined ? '–' : `${value}%`
    }
}
