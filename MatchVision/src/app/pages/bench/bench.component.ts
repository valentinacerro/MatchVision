import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core'
import { ActivatedRoute, RouterModule } from '@angular/router'
import { forkJoin, timeout } from 'rxjs'
import { Match } from '../../Models/Match'
import { MatchesService } from '../../services/matchesService'
import { KpiRow, RallyStats, StatsService } from '../../services/statsService'
import { KpiViewComponent } from '../shared/kpiView/kpiView.component'

const REFRESH_MS = 5000
const REQUEST_TIMEOUT_MS = 15000 // a stalled request ends in an error and the next tick tries again

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
    private inFlight = false
    private skipped = 0

    constructor(private route: ActivatedRoute,
        private matchesService: MatchesService,
        private statsService: StatsService,
        private cdr: ChangeDetectorRef) {}

    ngOnInit(): void {
        this.matchId = Number(this.route.snapshot.paramMap.get('matchId'))
        this.refresh()
        this.timer = setInterval(() => {
            if (document.hidden) return
            // One refresh at a time: a slow answer is not overtaken by the next tick
            if (this.inFlight) {
                if (++this.skipped >= 3) {
                    this.error = 'Aggiornamento lento: attendo la risposta del server'
                    this.cdr.detectChanges()
                }
                return
            }
            this.refresh()
        }, REFRESH_MS)
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

    // Set shown: the closed one until the next set starts (as on the game screen)
    get setLabel(): number {
        const l = this.live
        return l && l.endSetClicked && !l.allSetsPlayed ? l.setNumber - 1 : l?.setNumber
    }

    refresh(): void {
        const request = ++this.request
        this.inFlight = true
        this.matchesService.getMatch(this.matchId).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
            next: (match) => {
                if (request !== this.request) return
                this.match = match
                // Over or not started: the whole match (the chosen scope comes back when a set is live)
                const setId = match.live_state?.setId
                const bySet = this.scope === 'set' && setId
                const kpi = bySet ? this.statsService.getSetKpi(setId) : this.statsService.getMatchKpi(this.matchId)
                const rallies = bySet ? this.statsService.getSetRallyStats(setId) : this.statsService.getMatchRallyStats(this.matchId)
                forkJoin({ rows: kpi, rallies }).pipe(timeout(REQUEST_TIMEOUT_MS)).subscribe({
                    next: ({ rows, rallies }) => {
                        if (request !== this.request) return
                        this.rows = rows
                        this.rallies = rallies
                        this.updatedAt = new Date()
                        this.error = ''
                        this.inFlight = false
                        this.skipped = 0
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
        this.inFlight = false
        this.skipped = 0
        console.error('Errore aggiornamento panchina', err)
        this.error = 'Aggiornamento non riuscito: riprovo tra poco'
        this.cdr.detectChanges()
    }
}
