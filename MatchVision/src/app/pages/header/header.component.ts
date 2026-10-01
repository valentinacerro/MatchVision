import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../services/authService';

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

  logout() {
    this.auth.logout();
  }
}
