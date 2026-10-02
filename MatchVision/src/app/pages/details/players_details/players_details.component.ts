import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RouterModule } from '@angular/router';
import { PlayersService } from '../../../services/playersService';
import { Match } from '../../../Models/Match';
import { Team } from '../../../Models/Team';
import { Player } from '../../../Models/Player';
import { StatsService } from '../../../services/statsService';
import { BoxRow } from '../../shared/kpiView/boxScore';
import { HistoryLine, playerHistory, playerTotal } from '../../shared/season/season';
import { TrendChartComponent } from '../../shared/trendChart/trendChart.component';

@Component({
  selector: 'app-players_details',
  standalone: true,
  imports: [
    RouterModule,
    TrendChartComponent,
  ],
  templateUrl: './players_details.component.html',
  styleUrls: ['./players_details.component.scss']
})

export class PlayersDetailsComponent implements OnInit{
    title = 'PlayersDetails'
    player: Player | null =  null
    matches!: Match[]
    teams!: Team[]

    // The player match by match (only matches with a touch of theirs) and over all of them
    history: HistoryLine[] = []
    total: BoxRow | null = null
    historyLoaded = false

    constructor(private route: ActivatedRoute, private playersService: PlayersService, private statsService: StatsService,
        private cdr: ChangeDetectorRef){}

    ngOnInit(): void {
        this.matches = []
        this.teams = []

        let id = Number(this.route.snapshot.paramMap.get('id'))
        
        if (id) {            
            this.loadPlayer(id)
            this.loadMatches(id)
            this.loadTeams(id)
            this.loadHistory(id)
        }
    }

    loadHistory(id: number): void {
        this.statsService.getPlayerHistory(id).subscribe({
            next: (entries) => {
                this.history = playerHistory(entries)
                this.total = playerTotal(entries)
                this.historyLoaded = true
                this.cdr.detectChanges()
            },
            error: (err) => console.error('Errore caricamento storico', err)
        })
    }

    get series() {
        return {
            points: this.history.map(h => h.box.points),
            hit: this.history.map(h => h.box.attack.tot ? h.box.attack.hitPct : null),
            reception: this.history.map(h => h.box.reception.tot ? h.box.reception.avg : null),
        }
    }

    // Sets won and lost, from the saved results ('in corso' while the match is being scouted)
    setsLabel(match: Match): string {
        const results = match.results ?? []
        if (!results.length) return 'in corso'
        const won = results.filter(r => r.home_score > r.guest_score).length
        return `${won}-${results.length - won}`
    }

    pct(value: number | null | undefined): string {
        return value === null || value === undefined ? '–' : `${String(value).replace('.', ',')}%`
    }

    num(value: number | null | undefined): string {
        return value === null || value === undefined ? '–' : value.toFixed(2).replace('.', ',')
    }
    
    loadPlayer(id: number): void {
        this.playersService.getPlayer(id).subscribe({
            next: (res) => {
                this.player = res
                this.cdr.detectChanges()
            },
            error: (err) => console.error('Errore caricamento dettagli player', err)
        });
    }

    loadMatches(id: number): void {
        this.playersService.getPlayerMatches(id).subscribe({
            next: (res) => {
            this.matches = res;
            this.cdr.detectChanges();
        },
        error: (err) => console.error('Errore caricamento partite', err)
        })
    }
    
    loadTeams(id: number): void {
        this.playersService.getPlayerTeams(id).subscribe({
            next: (res) => {
            this.teams = res;
            this.cdr.detectChanges();
        },
        error: (err) => console.error('Errore caricamento squadre', err)
        })
    }
}