import { Component, Input, OnChanges } from '@angular/core'
import { KpiRow, RallyStats, TouchMapEntry } from '../../../services/statsService'
import { ZoneChartComponent } from '../zoneChart/zoneChart.component'
import { ZoneStats, zoneStats } from '../zoneChart/zoneStats'
import { POINT_REASONS, Team } from '../../game/rallyEngine'
import { BoxRow, boxScore } from './boxScore'

export const FUNDAMENTALS_IN_PLAY_ORDER = ['Battuta', 'Ricezione', 'Alzata', 'Attacco', 'Muro', 'Difesa']
const ROTATIONS = 'Rotazioni'
const POINTS = 'Punti'
const BOX = 'Box score'
const ZONES = 'Zone'

export interface PointGroup { label: string; total: number; items: { label: string; count: number }[] }
export interface TeamPointsView { team: Team; label: string; total: number; groups: PointGroup[]; unspecified: number }

// How the points of each team were won: winners of that team, errors of the other one
export function pointsView(rallies: RallyStats | null): TeamPointsView[] {
    const points = rallies?.points
    if (!points) return []
    return (['home', 'guests'] as Team[]).map(team => {
        const p = points[team]
        const group = (gift: boolean, label: string): PointGroup => {
            const items = POINT_REASONS.filter(r => r.team === team && r.gift === gift)
                .map(r => ({ label: r.short, count: p.reasons[r.code] ?? 0 }))
            return { label, total: items.reduce((sum, i) => sum + i.count, 0), items: items.filter(i => i.count > 0) }
        }
        return team === 'home'
            ? { team, label: 'CASA', total: p.total, unspecified: p.unspecified,
                groups: [group(false, 'Nostri punti vincenti'), group(true, 'Errori avversari')] }
            : { team, label: 'OSPITI', total: p.total, unspecified: p.unspecified,
                groups: [group(false, 'Punti vincenti avversari'), group(true, 'Nostri errori')] }
    })
}

// Statistics tables (KPI per player and fundamental, side-out / break-point per rotation).
// Presentation only: the data comes from the time-out panel or from the match details page.
@Component({
    selector: 'app-kpi-view',
    standalone: true,
    imports: [ZoneChartComponent],
    templateUrl: './kpiView.component.html',
    styleUrls: ['./kpiView.component.scss']
})
export class KpiViewComponent implements OnChanges {

    @Input() rows: KpiRow[] = []
    @Input() rallies: RallyStats | null = null
    @Input() map: TouchMapEntry[] = [] // serves and attacks with their zones

    readonly grades: (keyof KpiRow)[] = ['++', '+', '!', '—', '— —']
    readonly ROTATIONS = ROTATIONS
    readonly POINTS = POINTS
    readonly BOX = BOX
    readonly ZONES = ZONES
    zoneFundamental: 'Battuta' | 'Attacco' = 'Attacco'
    zonePlayer: number | null = null // null = the whole team
    view = BOX // the box score, a fundamental, POINTS or ROTATIONS

    ngOnChanges(): void {
        // Keep the chosen view if it still has data, otherwise show the first one available
        const available = [...(this.rows.length ? [BOX] : []), ...this.availableFundamentals, ...(this.hasMap ? [ZONES] : []), ...(this.rallies?.total ? [POINTS] : []), ...(this.rallies?.rotations?.length ? [ROTATIONS] : [])]
        if (available.length > 0 && !available.includes(this.view)) this.view = available[0]
    }

    get availableFundamentals(): string[] {
        return FUNDAMENTALS_IN_PLAY_ORDER.filter(f => this.rows.some(r => r.fundamental === f))
    }

    get hasMap(): boolean {
        return this.map.some(e => e.fundamental === 'Battuta' || e.fundamental === 'Attacco')
    }

    get zone(): ZoneStats {
        return zoneStats(this.map, this.zoneFundamental, this.zonePlayer)
    }

    // Players with serves or attacks in the selection, by shirt number
    get zonePlayers(): { id: number; label: string }[] {
        const ids = new Set(this.map.filter(e => e.fundamental === this.zoneFundamental).map(e => e.player_id))
        const seen = new Map<number, string>()
        for (const r of this.rows)
            if (!r.team && r.player_id !== null && ids.has(r.player_id)) seen.set(r.player_id, `${r.number !== null ? '#' + r.number + ' ' : ''}${r.player}`)
        return [...seen.entries()].map(([id, label]) => ({ id, label }))
    }

    setZoneFundamental(f: 'Battuta' | 'Attacco'): void {
        this.zoneFundamental = f
        if (this.zonePlayer !== null && !this.zonePlayers.some(p => p.id === this.zonePlayer)) this.zonePlayer = null
    }

    setZonePlayer(value: string): void {
        this.zonePlayer = value ? Number(value) : null
    }

    get box(): BoxRow[] {
        return boxScore(this.rows)
    }

    num(value: number | null): string {
        return value === null ? '–' : value.toFixed(2).replace('.', ',')
    }

    get points(): TeamPointsView[] {
        return pointsView(this.rallies)
    }

    get visibleRows(): KpiRow[] {
        return this.rows.filter(r => r.fundamental === this.view)
    }

    pct(value: number | null | undefined): string {
        return value === null || value === undefined ? '–' : `${value}%`
    }
}
