import { ChangeDetectorRef, Component, OnInit } from '@angular/core'
import { ActivatedRoute, RouterModule } from '@angular/router'
import { forkJoin } from 'rxjs'
import { Match } from '../../../Models/Match'
import { Team } from '../../../Models/Team'
import { Set } from '../../../Models/Set'
import { MatchesService } from '../../../services/matchesService'
import { GlobalService } from '../../../services/globalService'
import { KpiRow, RallyStats, StatsService, TouchMapEntry } from '../../../services/statsService'
import { KpiViewComponent, pointsView } from '../../shared/kpiView/kpiView.component'
import { boxScore } from '../../shared/kpiView/boxScore'

@Component({
    selector: 'app-matches_details',
    standalone: true,
    imports: [
        RouterModule,
        KpiViewComponent,
    ],
    templateUrl: './matches_details.component.html',
    styleUrls: ['./matches_details.component.scss']
})

export class MatchesDetailsComponent implements OnInit{

    title = 'MatchesDetails'
    match: Match | null =  null
    team!: Team
    sets!: Set[]
    id!: number

    // Statistics: the whole match or one set
    scope: 'match' | number = 'match'
    rows: KpiRow[] = []
    rallies: RallyStats | null = null
    map: TouchMapEntry[] = []
    statsLoading = false
    statsError = ''
    private request = 0

    constructor(private route: ActivatedRoute,
        private matchesService: MatchesService, 
        private statsService: StatsService,
        public globalService: GlobalService,
        private cdr: ChangeDetectorRef
    ){}
  
    ngOnInit(): void {
        this.sets = []

        this.id = Number(this.route.snapshot.paramMap.get('id'))
        
        if (this.id) this.loadMatch(this.id)
    }

    loadMatch(id: number) {
        this.matchesService.getMatch(id).subscribe({
            next: (res) => {
                this.match = res
                this.loadSets(res.id)
                this.loadTeam(res.id)
                this.loadStats()
                this.cdr.detectChanges()
            },
            error: (err) => console.error('Errore caricamento dettagli match', err)
        });
    }
  
    loadTeam(id: number): void {
        this.matchesService.getMatchTeam(id).subscribe({
            next: (res) => {
                this.team = res
                this.cdr.detectChanges()
            },
            error: (err) => console.error('Errore caricamento team', err)
        })
    }
    
    loadSets(id: number): void {
        this.matchesService.getMatchSets(id).subscribe({
            next: (res) => {
                this.sets = res
                this.cdr.detectChanges()
            },
            error: (err) => console.error('Errore caricamento set', err)
        })
    }

    buildMatchResults() {
        let results: string = ''
        this.sets.forEach((s, index) =>
            results = results.concat('[', String(s.home_score), '-', String(s.guest_score), '] ')
        )
        return results
    }

    setScope(scope: 'match' | number): void {
        this.scope = scope
        this.loadStats()
    }

    loadStats(): void {
        const request = ++this.request
        this.statsLoading = true
        this.statsError = ''
        const kpi = this.scope === 'match' ? this.statsService.getMatchKpi(this.id) : this.statsService.getSetKpi(this.scope)
        const rallies = this.scope === 'match' ? this.statsService.getMatchRallyStats(this.id) : this.statsService.getSetRallyStats(this.scope)
        const map = this.scope === 'match' ? this.statsService.getMatchTouchMap(this.id) : this.statsService.getSetTouchMap(this.scope)
        forkJoin({ rows: kpi, rallies, map }).subscribe({
            next: ({ rows, rallies, map }) => {
                if (request !== this.request) return
                this.rows = rows
                this.rallies = rallies
                this.map = map
                this.statsLoading = false
                this.cdr.detectChanges()
            },
            error: (err) => {
                if (request !== this.request) return
                console.error('Errore caricamento statistiche', err)
                this.statsLoading = false
                this.statsError = 'Statistiche non caricate: riprova'
                this.cdr.detectChanges()
            }
        })
    }

    get scopeLabel(): string {
        if (this.scope === 'match') return 'partita'
        const set = this.sets.find(s => s.id === this.scope)
        return set ? `set-${set.number}` : 'set'
    }

    // CSV with numbers (';' separator, opens in Excel with Italian settings), downloaded as a file
    // A CSV cell: numbers with the decimal comma, text quoted (and never read as a formula)
    private cell(v: any): string {
        if (v === null || v === undefined) return ''
        if (typeof v === 'number') return String(v).replace('.', ',')
        let text = String(v)
        if (/^[=+\-@]/.test(text)) text = "'" + text
        return '"' + text.replace(/"/g, '""') + '"'
    }

    exportCSV(): void {
        const header = ['Fondamentale', 'Numero', 'Giocatore', 'Tot', '++', '+', '!', '—', '— —', 'Positività %', 'Efficienza %', 'Errori %']
        const label = (h: string) => '"' + h.replace(/"/g, '""') + '"'
        // Box score first, as in the match report
        const lines = [['Numero', 'Giocatore', 'Punti', 'Errori', 'Saldo', 'Battute', 'Ace', 'Errori battuta',
            'Ricezioni', 'Media ricezione 0-3', 'Ricezione positiva %', 'Ricezione perfetta %',
            'Attacchi', 'Kill', 'Errori attacco', 'Kill %', 'Hit %', 'Muri punto'].map(label).join(';')]
        for (const r of boxScore(this.rows)) {
            lines.push([r.number, r.player, r.points, r.errors, r.balance, r.serve.tot, r.serve.aces, r.serve.errors,
                r.reception.tot, r.reception.avg, r.reception.positive, r.reception.perfect,
                r.attack.tot, r.attack.kills, r.attack.errors, r.attack.killPct, r.attack.hitPct, r.blocks].map(v => this.cell(v)).join(';'))
        }
        lines.push('')
        lines.push(header.map(label).join(';'))
        for (const r of this.rows) {
            lines.push([r.fundamental, r.number, r.player, r.tot, r['++'], r['+'], r['!'], r['—'], r['— —'], r.positivita, r.efficienza, r.errori]
                .map(v => this.cell(v)).join(';'))
        }
        if (this.rallies?.total) {
            lines.push('')
            lines.push(['Rotazione', 'In P1', 'Side-out vinti', 'Side-out totali', 'Side-out %', 'Break-point vinti', 'Break-point totali', 'Break-point %'].map(label).join(';'))
            const row = (label: string, p1: any, so: any, bp: any) =>
                [label, p1, so.won, so.total, so.pct, bp.won, bp.total, bp.pct].map(v => this.cell(v)).join(';')
            lines.push(row('Totale', null, this.rallies.sideout, this.rallies.breakpoint))
            for (const r of this.rallies.rotations)
                lines.push(row(r.rotation !== null ? `R${r.rotation}` : '–', r.p1 !== null ? `#${r.p1}` : null, r.sideout, r.breakpoint))
            // How the points were won, team by team
            const points = pointsView(this.rallies)
            if (points.length) {
                lines.push('')
                lines.push(['Punti', 'Voce', 'Numero'].map(label).join(';'))
                for (const t of points) {
                    lines.push([`Punti ${t.label}`, 'Totale', t.total].map(v => this.cell(v)).join(';'))
                    for (const g of t.groups) {
                        lines.push([`Punti ${t.label}`, g.label, g.total].map(v => this.cell(v)).join(';'))
                        for (const i of g.items) lines.push([`Punti ${t.label}`, `${g.label}: ${i.label}`, i.count].map(v => this.cell(v)).join(';'))
                    }
                    if (t.unspecified) lines.push([`Punti ${t.label}`, 'Non specificati', t.unspecified].map(v => this.cell(v)).join(';'))
                }
            }
        }
        // BOM so Excel reads the accents correctly
        const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${(this.match?.name ?? 'partita').replace(/[^\w-]+/g, '_')}_${this.scopeLabel}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }
}
