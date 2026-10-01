import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core'
import { RouterModule } from '@angular/router'
import { MatchesService } from '../../services/matchesService'
import { NewMatchModalComponent } from './newMatchModal/newMatchModal.component';
import { Match } from '../../Models/Match';
import { CommonModule } from '@angular/common'; 
import { FormsModule } from '@angular/forms';
import { GlobalService } from '../../services/globalService';
import { OutboxService } from '../../services/outboxService';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-matches',
  standalone: true,
  imports: [
    RouterModule,
    NewMatchModalComponent,
    CommonModule,
    FormsModule
],
  templateUrl: './matches.component.html',
  styleUrls: ['./matches.component.scss']
})

export class MatchesComponent implements OnInit, OnDestroy{

    constructor(private matchesService: MatchesService, public globalService: GlobalService, private outbox: OutboxService) {}

    private synced: Subscription | null = null
    
    @ViewChild(NewMatchModalComponent) newMatchModal!: NewMatchModalComponent

    searchText: string = ''

    // to delete matches
    showDeleteButtons = false
    
    ngOnInit(): void { 
        this.globalService.loadMatches()
        // A match created offline reached the server: the list shows it with its server id
        this.synced = this.outbox.events.subscribe(e => { if (e.type === 'resolved') this.globalService.loadMatches() })
    }

    ngOnDestroy(): void {
        this.synced?.unsubscribe()
    }

    openNewMatchModal(){
        this.newMatchModal.open()
    }

    closeNewMatchModal() {
        console.log(this.newMatchModal.closeResult)
    }

    toggleDeleteMode() {
        this.showDeleteButtons = !this.showDeleteButtons;
    }

    // To delete a specific match
    deleteMatch(id: any){
        this.matchesService.deleteMatch(id).subscribe({
        next: () => {
            console.log('Match eliminato')
            this.globalService.loadMatches()
        },
        error: (err) => console.error('Errore eliminazione match', err)
        })
    }

    // To filter matches
    get filteredMatches(): Match[] {
        const all = [...this.outbox.localMatches(), ...this.globalService.allMatches()]
        if (!this.searchText) 
            return all
        return all.filter(m =>
        m.name.toLowerCase().includes(this.searchText.toLowerCase()) ||
        this.globalService.transformDateFormat(m.timestamp).includes(this.searchText.toLowerCase())
        );
    }

}
