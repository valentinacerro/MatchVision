import { Component, inject, signal } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/authService';
import { PwaService } from '../../services/pwaService';

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
  updateLater = signal(false);

  logout() {
    this.auth.logout();
  }
}
