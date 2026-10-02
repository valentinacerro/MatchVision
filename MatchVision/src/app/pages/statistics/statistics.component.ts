import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core'
import { RouterModule } from '@angular/router'
import { GlobalService } from '../../services/globalService'
import { SeasonStats, StatsService } from '../../services/statsService'
import { KpiViewComponent } from '../shared/kpiView/kpiView.component'
import { isoDate, seasonStart, seasonTrend, TrendLine } from '../shared/season/season'
import { TrendChartComponent } from '../shared/trendChart/trendChart.component'

type Period = 'season' | 'last30' | 'all' | 'custom'

// Statistics of several matches together: a team (or all), a period, and the matches one after the other
@Component({
  selector: 'app-statistics',
  standalone: true,
  templateUrl: './statistics.component.html',
  styleUrls: ['./statistics.component.scss'],
  imports: [RouterModule, KpiViewComponent, TrendChartComponent]
})
export class StatisticsComponent implements OnInit {
  private statsService = inject(StatsService)
  private cdr = inject(ChangeDetectorRef)
  globalService = inject(GlobalService)

  team: number | null = null
  period: Period = 'season'
  from = isoDate(seasonStart(new Date()))
  to = ''
  stats: SeasonStats | null = null
  trend: TrendLine[] = []
  loading = false
  error = ''
  private request = 0

  // e.g. "2026/27"
  readonly seasonLabel = (() => {
    const start = seasonStart(new Date()).getFullYear()
    return `${start}/${String(start + 1).slice(2)}`
  })()

  ngOnInit(): void {
    this.globalService.loadTeams()
    this.load()
  }

  setTeam(value: string): void {
    this.team = value ? Number(value) : null
    this.load()
  }

  setPeriod(period: Period): void {
    this.period = period
    const today = new Date()
    if (period === 'season') { this.from = isoDate(seasonStart(today)); this.to = '' }
    if (period === 'last30') { this.from = isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)); this.to = '' }
    if (period === 'all') { this.from = ''; this.to = '' }
    this.load()
  }

  setDate(which: 'from' | 'to', value: string): void {
    this[which] = value
    this.period = 'custom'
    this.load()
  }

  load(): void {
    const request = ++this.request
    this.loading = true
    this.error = ''
    this.statsService.getSeasonStats({ team: this.team, from: this.from, to: this.to }).subscribe({
      next: (stats) => {
        if (request !== this.request) return
        this.stats = stats
        this.trend = seasonTrend(stats)
        this.loading = false
        this.cdr.detectChanges()
      },
      error: (err) => {
        if (request !== this.request) return
        console.error('Errore caricamento statistiche di stagione', err)
        this.loading = false
        this.error = 'Statistiche non caricate: controlla la connessione e riprova'
        this.cdr.detectChanges()
      }
    })
  }

  // Matches won and lost (a match without a winner yet counts in neither)
  get record(): [number, number] {
    const m = this.stats?.matches ?? []
    return [m.filter(x => x.sets_won[0] > x.sets_won[1]).length, m.filter(x => x.sets_won[1] > x.sets_won[0]).length]
  }

  get series() {
    return {
      points: this.trend.map(t => t.box?.points ?? null),
      hit: this.trend.map(t => t.box?.attack.tot ? t.box.attack.hitPct : null),
      reception: this.trend.map(t => t.box?.reception.tot ? t.box.reception.avg : null),
      sideout: this.trend.map(t => t.sideout),
    }
  }

  pct(value: number | null | undefined): string {
    return value === null || value === undefined ? '–' : `${String(value).replace('.', ',')}%`
  }

  num(value: number | null | undefined): string {
    return value === null || value === undefined ? '–' : value.toFixed(2).replace('.', ',')
  }
}
