import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/authService';
import { PwaService } from '../../services/pwaService';
import { OutboxService } from '../../services/outboxService';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterModule,
  ],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent {
  auth = inject(AuthService);
  pwa = inject(PwaService);
  outbox = inject(OutboxService);
  updateLater = signal(false);
  syncOpen = signal(false);

  // Shown only while something is stuck (no connection, server down): with the network it is sent in a moment
  get waiting(): boolean {
    return this.outbox.pending() > 0 && (this.pwa.offline() || !!this.outbox.lastError());
  }

  get syncProblem(): boolean {
    return this.outbox.blockedCount() > 0 || this.outbox.rejectedCount() > 0;
  }

  discardBlocked() {
    if (!confirm('Scartare le modifiche non inviate delle partite aperte su un altro dispositivo? Resta la versione dell\'altro dispositivo.')) return;
    this.outbox.discardBlocked();
    this.closeSyncIfDone();
  }

  discardRejected() {
    this.outbox.discardRejected();
    this.closeSyncIfDone();
  }

  private closeSyncIfDone() {
    if (!this.syncProblem) this.syncOpen.set(false);
  }

  logout() {
    this.outbox.logout();
  }
}
