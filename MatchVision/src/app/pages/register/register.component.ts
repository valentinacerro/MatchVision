import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService, authErrorMessages, nextUrl } from '../../services/authService';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    RouterModule,
    ReactiveFormsModule,
  ],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // The server checks the password rules (length, too common, only digits...) and explains what is wrong
  registerForm = inject(FormBuilder).nonNullable.group({
    name: [''],
    surname: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  errors = signal<string[]>([]);
  sending = signal(false);

  invalid(name: 'email' | 'password'): boolean {
    const control = this.registerForm.controls[name];
    return control.invalid && control.touched;
  }

  onSubmit() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }
    if (this.sending()) return;
    this.sending.set(true);
    this.errors.set([]);
    this.auth.register(this.registerForm.getRawValue()).subscribe({
      next: () => this.router.navigateByUrl(nextUrl(this.route)),
      error: (err) => {
        this.sending.set(false);
        this.errors.set(authErrorMessages(err));
      }
    });
  }
}
