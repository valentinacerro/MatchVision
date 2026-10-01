import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core'
import { ActivatedRoute, RouterModule } from '@angular/router'
import { forkJoin, of, switchMap } from 'rxjs'
import { Match } from '../../Models/Match'
import { Set } from '../../Models/Set'
import { Team } from '../../Models/Team'
import { MatchesService } from '../../services/matchesService'
import { KpiRow, RallyStats, StatsService, TouchMapEntry } from '../../services/statsService'
import { BoxRow, boxScore } from '../shared/kpiView/boxScore'
import { pointsView, TeamPointsView } from '../shared/kpiView/kpiView.component'
import { ZoneChartComponent } from '../shared/zoneChart/zoneChart.component'
import { ZoneStats, zoneStats } from '../shared/zoneChart/zoneStats'

// One line per set: score and the numbers a coach compares from set to set
export interface SetLine {
    number: number
    home: number
    guests: number
    sideout: number | null
    breakpoint: number | null
    hitPct: number | null
    aces: number
    errors: number
    gifted: [number, number] // points given away: by the opponent, by us
}

export function setLine(set: Set, rows: KpiRow[], rallies: RallyStats): SetLine {
    const team = boxScore(rows).find(r => r.team)
    return {
        number: set.number, home: set.home_score, guests: set.guest_score,
        sideout: rallies.sideout.pct, breakpoint: rallies.breakpoint.pct,
        hitPct: team?.attack.hitPct ?? null, aces: team?.serve.aces ?? 0, errors: team?.errors ?? 0,
        gifted: [rallies.points?.home.gifted ?? 0, rallies.points?.guests.gifted ?? 0],
    }
}

// Printable match report (two A4 pages): the browser prints it or saves it as PDF
@Component({
    selector: 'app-report',
    standalone: true,
    imports: [RouterModule, ZoneChartComponent],
    templateUrl: './report.component.html',
    styleUrls: ['./report.component.scss']
})
export class ReportComponent implements OnInit {

    private route = inject(ActivatedRoute)
    private matchesService = inject(MatchesService)
    private statsService = inject(StatsService)
    private cdr = inject(ChangeDetectorRef)

    id = 0
    loading = true
    error = ''
    match: Match | null = null
    team: Team | null = null
    sets: Set[] = []
    box: BoxRow[] = []
    rallies: RallyStats | null = null
    points: TeamPointsView[] = []
    serves: ZoneStats | null = null
    attacks: ZoneStats | null = null
    lines: SetLine[] = []
    readonly printedAt = new Date()

    ngOnInit(): void {
        this.id = Number(this.route.snapshot.paramMap.get('id'))
        forkJoin({
            match: this.matchesService.getMatch(this.id),
            team: this.matchesService.getMatchTeam(this.id),
            sets: this.matchesService.getMatchSets(this.id),
            rows: this.statsService.getMatchKpi(this.id),
            rallies: this.statsService.getMatchRallyStats(this.id),
            map: this.statsService.getMatchTouchMap(this.id),
        }).pipe(switchMap(all => {
            const perSet = all.sets.map(s => forkJoin({ set: of(s), rows: this.statsService.getSetKpi(s.id), rallies: this.statsService.getSetRallyStats(s.id) }))
            return forkJoin({ all: of(all), perSet: perSet.length ? forkJoin(perSet) : of([]) })
        })).subscribe({
            next: ({ all, perSet }) => {
                this.match = all.match
                this.team = all.team
                this.sets = [...all.sets].sort((a, b) => a.number - b.number)
                this.box = boxScore(all.rows)
                this.rallies = all.rallies
                this.points = pointsView(all.rallies)
                this.serves = zoneStats(all.map, 'Battuta', null)
                this.attacks = zoneStats(all.map, 'Attacco', null)
                this.lines = perSet.map(p => setLine(p.set, p.rows, p.rallies)).sort((a, b) => a.number - b.number)
                this.loading = false
                this.cdr.detectChanges()
            },
            error: (err) => {
                console.error('Errore caricamento report', err)
                this.loading = false
                this.error = 'Report non caricato: controlla la connessione e ricarica la pagina'
                this.cdr.detectChanges()
            }
        })
    }

    // Sets won by each team (only sets with a winner)
    get setsWon(): [number, number] {
        return [this.sets.filter(s => s.home_score > s.guest_score).length, this.sets.filter(s => s.guest_score > s.home_score).length]
    }

    get date(): string {
        return this.match?.timestamp ? new Date(this.match.timestamp).toLocaleDateString('it-IT') : ''
    }

    pct(value: number | null | undefined): string {
        return value === null || value === undefined ? '–' : `${String(value).replace('.', ',')}%`
    }

    num(value: number | null): string {
        return value === null ? '–' : value.toFixed(2).replace('.', ',')
    }

    print(): void {
        window.print()
    }
}
