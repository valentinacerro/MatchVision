import { Component, Input } from '@angular/core'
import { zoneCenter } from '../../game/rallyEngine'
import { ZoneStats } from './zoneStats'

const SIZE = 300 // one half: 9 x 9 m
const ROWS = [[4, 3, 2], [7, 8, 9], [5, 6, 1]] // DataVolley zones from the net, seen by the team on that half

interface Cell { zone: number; x: number; y: number; fill: number; label: string; sub: string }

// Court chart as in DataVolley / openvolley: the team that serves or attacks at the bottom, the half where
// the ball goes at the top, both seen from behind our end line (our left = the left of the chart)
@Component({
    selector: 'app-zone-chart',
    standalone: true,
    templateUrl: './zoneChart.component.html',
    styleUrls: ['./zoneChart.component.scss']
})
export class ZoneChartComponent {

    @Input({ required: true }) stats!: ZoneStats
    @Input() attack = false
    readonly SIZE = SIZE

    // Opponent half: its left is our right, so its zones are mirrored
    get targetCells(): Cell[] {
        const max = Math.max(1, ...this.stats.ends.map(z => z.tot))
        return this.stats.ends.map(z => {
            const { col, row } = this.place(z.zone)
            return { zone: z.zone, x: (2 - col) * 100, y: (2 - row) * 100, fill: z.tot / max,
                label: z.tot ? `${z.tot}` : '', sub: z.share !== null && z.tot ? `${z.share}%` : '' }
        })
    }

    // Our half (attacks): where they started
    get startCells(): Cell[] {
        const max = Math.max(1, ...this.stats.starts.map(z => z.tot))
        return ROWS.flat().map(zone => {
            const s = this.stats.starts.find(z => z.zone === zone)
            const { col, row } = this.place(zone)
            return { zone, x: col * 100, y: SIZE + row * 100, fill: s ? s.tot / max : 0,
                label: s ? `${s.tot}` : '', sub: s?.hitPct !== null && s ? `hit ${s.hitPct}%` : '' }
        })
    }

    get dots() {
        return this.stats.points.map(p => {
            const end = { x: (1 - p.u) * SIZE, y: SIZE - p.d * SIZE }
            const s = p.start ? zoneCenter(p.start) : null
            return { ...end, color: this.color(p.outcome), from: s && this.attack ? { x: s.u * SIZE, y: SIZE + s.d * SIZE } : null }
        })
    }

    private place(zone: number): { col: number; row: number } {
        const row = ROWS.findIndex(r => r.includes(zone))
        return { row, col: ROWS[row].indexOf(zone) }
    }

    private color(outcome: string): string {
        return outcome === '++' ? '#198754' : outcome === '— —' ? '#dc3545' : '#0d6efd'
    }
}
