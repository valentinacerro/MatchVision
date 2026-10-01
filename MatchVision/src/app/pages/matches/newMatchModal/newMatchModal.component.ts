import { ChangeDetectorRef, Component, EventEmitter, inject, Output, signal, TemplateRef, ViewChild, WritableSignal } from '@angular/core';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule } from '@angular/forms'
import { MatchesService } from '../../../services/matchesService';
import { Match } from '../../../Models/Match';
import { GlobalService } from '../../../services/globalService';
import { RouterModule } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { timeout } from 'rxjs';
import { OutboxService } from '../../../services/outboxService';
import { Player } from '../../../Models/Player';

function newClientId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// The server cannot be reached (no network, Wi-Fi without internet, server down)
function unreachable(err: any): boolean {
    return err?.name === 'TimeoutError' || (err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 502))
}

@Component({
	selector: 'app-new-match-modal',
    standalone: true,
    imports: [
        FormsModule,
        RouterModule
    ],
	templateUrl: './newMatchModal.component.html',
    styleUrls: ['./newMatchModal.component.scss']
})

export class NewMatchModalComponent {

    constructor(public globalService: GlobalService, private cdr: ChangeDetectorRef) {}
  
    @Output() matchCreated = new EventEmitter<void>();

    @ViewChild('content', { static: true }) content!: TemplateRef<any>;

    private matchesService = inject(MatchesService);
    private outbox = inject(OutboxService);
    private modalService = inject(NgbModal);
    public closeResult: WritableSignal<string> = signal('');

    newMatch: Match = this.emptyMatch()

    private emptyMatch(): Match {
        // Default format: best of 5, sets to 25, tie-break to 15
        return { id: 0, name: '', team_id: 0, timestamp: new Date(), result: null, sets_to_win: 3, set_points: 25, tiebreak_points: 15 }
    }

    matchInfoSaved: boolean = false
    saving: boolean = false
    errorMessage: string = ''
    createdMatch: Match | null = null // kept so a retry only reloads the players
    savedOffline: boolean = false // created on this device only: it reaches the server with the connection
    private clientId: string = newClientId() // same for every attempt: the server never saves the match twice
    private session: number = 0 // answers from a previous opening are ignored

    ngOnInit(): void {
        this.globalService.loadTeams();
    }

    // To open the modal
    public open() {
        this.newMatch = this.emptyMatch()
        this.matchInfoSaved = false
        this.saving = false
        this.errorMessage = ''
        this.createdMatch = null
        this.savedOffline = false
        this.clientId = newClientId()
        this.session++
        this.modalService.open(this.content, { ariaLabelledBy: 'new-match-modal' }).result.then(
            (result) => {
            this.closeResult.set(`Closed with: ${result}`);
            },
            (reason) => {
            // this.closeResult.set(`Dismissed ${this.getDismissReason(reason)}`);
            },
        );
    }

    // To save the match
    public saveMatch(form: any, modal: any) {
        if (form.valid && !this.saving && !this.matchInfoSaved) {
            this.saving = true
            this.errorMessage = ''
            const session = this.session
            if (this.createdMatch) {
                this.loadPlayers(this.createdMatch, session)
                return
            }
            const match = { ...this.newMatch, client_id: this.clientId }
            this.matchesService.createMatch(match).pipe(timeout(10000)).subscribe({
                next: (res) => {
                    if (session !== this.session) return
                    this.createdMatch = res
                    this.cdr.detectChanges()
                    console.log("Dati partita salvata", res)
                    this.loadPlayers(res, session)
                },
                error: (err) => {
                    if (session !== this.session) return
                    if (unreachable(err)) this.saveOffline(match, session)
                    else this.showError('Errore salvataggio nuovo match', err, session)
                }
            });
        }
    }

    // No connection: the match is created on this device and the outbox sends it later
    // (with the same client id, so a request that timed out but arrived is not saved twice)
    private saveOffline(match: Match & { client_id: string }, session: number) {
        const temp = this.outbox.tempId()
        try {
            this.outbox.enqueue('match', temp, { temp, client_id: match.client_id, name: match.name, team_id: match.team_id,
                sets_to_win: match.sets_to_win, set_points: match.set_points, tiebreak_points: match.tiebreak_points,
                timestamp: new Date().toISOString() })
        } catch (err) {
            this.showError('Memoria del dispositivo piena: partita non salvata', err, session)
            return
        }
        this.savedOffline = true
        this.createdMatch = { ...match, id: temp }
        this.loadPlayers(this.createdMatch, session)
    }

    private loadPlayers(match: Match, session: number) {
        this.globalService.getPlayersByTeamId(match.team_id).subscribe({
            next: (playersRes) => this.start(match, playersRes, session),
            error: (playersErr) => {
                // Without a connection the players come with the list of teams kept on the device
                const team = this.globalService.allTeams().find(t => t.id === match.team_id) as any
                if (unreachable(playersErr) && team?.players?.length) this.start(match, team.players, session)
                else this.showError('Errore caricamento giocatori', playersErr, session)
            }
        })
    }

    private start(match: Match, players: Player[], session: number) {
        if (session !== this.session) return
        this.globalService.currentMatch.set(match) //set general current match
        this.globalService.currentPlayers.set(players)
        // Only now the game can start: match and players are ready
        this.matchInfoSaved = true
        this.saving = false
        this.matchCreated.emit()
        this.cdr.detectChanges()
    }

    private showError(message: string, err: any, session: number) {
        if (session !== this.session) return
        console.error(message, err)
        this.saving = false
        this.errorMessage = message + '. Riprova.'
        this.cdr.detectChanges()
    }
 
    
}