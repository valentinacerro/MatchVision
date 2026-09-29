import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core'
import { ActivatedRoute, RouterModule } from '@angular/router'
import { forkJoin } from 'rxjs'
import { Match } from '../../Models/Match'
import { MatchesService } from '../../services/matchesService'
import { KpiRow, RallyStats, StatsService } from '../../services/statsService'
import { KpiViewComponent } from '../shared/kpiView/kpiView.component'

const REFRESH_MS = 5000

// Read-only view for the bench: follows a match being scouted on another device
@Component({
    selector: 'app-bench',
    standalone: true,
    imports: [RouterModule, KpiViewComponent],
    templateUrl: './bench.component.html',
    styleUrls: ['./bench.component.scss']
})
export class BenchComponent implements OnInit, OnDestroy {

    matchId = 0
    match: Match | null = null
    scope: 'set' | 'match' = 'set'
    rows: KpiRow[] = []
    rallies: RallyStats | null = null
    updatedAt: Date | null = null
    error = ''
    private timer: any = null
    private request = 0

    constructor(private route: ActivatedRoute,
        private matchesService: MatchesService,
        private statsService: StatsService,
        private cdr: ChangeDetectorRef) {}

    ngOnInit(): void {
        this.matchId = Number(this.route.snapshot.paramMap.get('matchId'))
        this.refresh()
        this.timer = setInterval(() => { if (!document.hidden) this.refresh() }, REFRESH_MS)
    }

    ngOnDestroy(): void {
        clearInterval(this.timer)
    }

    get live(): any {
        return this.match?.live_state ?? null
    }

    get setsWon(): { home: number; guests: number } {
        const results = this.live?.results ?? this.match?.results ?? []
        return {
            home: results.filter((r: any) => r.home_score > r.guest_score).length,
            guests: results.filter((r: any) => r.guest_score > r.home_score).length,
        }
    }

    setScope(scope: 'set' | 'match'): void {
        this.scope = scope
        this.refresh()
    }

    refresh(): void {
        const request = ++this.request
        this.matchesService.getMatch(this.matchId).subscribe({
            next: (match) => {
                if (request !== this.request) return
                this.match = match
                const setId = match.live_state?.setId
                const bySet = this.scope === 'set' && setId
                const kpi = bySet ? this.statsService.getSetKpi(setId) : this.statsService.getMatchKpi(this.matchId)
                const rallies = bySet ? this.statsService.getSetRallyStats(setId) : this.statsService.getMatchRallyStats(this.matchId)
                forkJoin({ rows: kpi, rallies }).subscribe({
                    next: ({ rows, rallies }) => {
                        if (request !== this.request) return
                        this.rows = rows
                        this.rallies = rallies
                        this.updatedAt = new Date()
                        this.error = ''
                        this.cdr.detectChanges()
                    },
                    error: (err) => this.fail(request, err),
                })
            },
            error: (err) => this.fail(request, err),
        })
    }

    private fail(request: number, err: any): void {
        if (request !== this.request) return
        console.error('Errore aggiornamento panchina', err)
        this.error = 'Aggiornamento non riuscito: riprovo tra poco'
        this.cdr.detectChanges()
    }
}
