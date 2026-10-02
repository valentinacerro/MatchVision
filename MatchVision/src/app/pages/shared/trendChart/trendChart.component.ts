import { Component, Input } from '@angular/core'

// A small line chart of one number match after match (points, hit %, reception average...)
@Component({
    selector: 'app-trend-chart',
    standalone: true,
    template: `
        <figure class="trend">
            <figcaption>{{ title }}</figcaption>
            @if (points.length === 0) {
                <div class="empty">–</div>
            } @else {
                <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" role="img" [attr.aria-label]="title">
                    <line [attr.x1]="P" [attr.y1]="H - 4" [attr.x2]="W - P" [attr.y2]="H - 4" class="axis"></line>
                    @if (min < 0 && max > 0) { <line [attr.x1]="P" [attr.y1]="y(0)" [attr.x2]="W - P" [attr.y2]="y(0)" class="zero"></line> }
                    <polyline [attr.points]="line" [attr.stroke]="color" class="line"></polyline>
                    @for (p of points; track p.i) {
                        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" [attr.fill]="color"></circle>
                        <text [attr.x]="p.x" [attr.y]="p.y - 8" class="value">{{ p.label }}</text>
                    }
                </svg>
            }
        </figure>`,
    styles: [`
        :host { display: block; flex: 1 1 14rem; min-width: 12rem; }
        .trend { margin: 0; }
        figcaption { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.2rem; }
        svg { width: 100%; height: auto; display: block; }
        .axis { stroke: #adb5bd; stroke-width: 1; }
        .zero { stroke: #adb5bd; stroke-dasharray: 3 3; }
        .line { fill: none; stroke-width: 2.5; }
        .value { font-size: 11px; text-anchor: middle; fill: #495057; }
        .empty { color: #6c757d; }
    `]
})
export class TrendChartComponent {
    @Input() title = ''
    @Input() values: (number | null)[] = []
    @Input() color = '#0d6efd'
    @Input() unit = ''      // '%' for percentages
    @Input() decimals = 0

    readonly W = 320
    readonly H = 110
    readonly P = 16

    // The range of the values with some room around (a trend reads better than from zero)
    get min(): number {
        const lo = Math.min(...this.known), hi = Math.max(...this.known)
        return lo - Math.max((hi - lo) * 0.15, Math.abs(lo) * 0.05, 0.05)
    }

    get max(): number {
        const lo = Math.min(...this.known), hi = Math.max(...this.known)
        return hi + Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.05, 0.05)
    }

    private get known(): number[] {
        return this.values.filter((v): v is number => v !== null)
    }

    y(v: number): number {
        return this.H - this.P - (v - this.min) / (this.max - this.min) * (this.H - 2 * this.P - 6)
    }

    // Matches without a value (e.g. no attacks) leave a gap in the dots, not in the line
    get points() {
        const n = Math.max(1, this.values.length - 1)
        return this.values.map((v, i) => ({ i, v })).filter(p => p.v !== null).map(p => ({
            i: p.i, x: this.P + p.i * (this.W - 2 * this.P) / n, y: this.y(p.v as number),
            label: (p.v as number).toFixed(this.decimals).replace('.', ',') + this.unit,
        }))
    }

    get line(): string {
        return this.points.map(p => `${p.x},${p.y}`).join(' ')
    }
}
