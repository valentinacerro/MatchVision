import { Component, inject, signal } from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService, authErrorMessages, nextUrl } from '../../services/authService';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})

export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  loginForm = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  errors = signal<string[]>([]);
  sending = signal(false);

  invalid(name: 'email' | 'password'): boolean {
    const control = this.loginForm.controls[name];
    return control.invalid && control.touched;
  }

  onSubmit() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }
    if (this.sending()) return;
    const { email, password } = this.loginForm.getRawValue();
    this.sending.set(true);
    this.errors.set([]);
    this.auth.login(email, password).subscribe({
      next: () => this.router.navigateByUrl(nextUrl(this.route)),
      error: (err) => {
        this.sending.set(false);
        this.errors.set(authErrorMessages(err));
      }
    });
  }
}
