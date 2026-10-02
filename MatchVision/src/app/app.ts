    import { Component, inject, signal } from '@angular/core'
    import { toSignal } from '@angular/core/rxjs-interop'
    import { NavigationEnd, Router, RouterOutlet, RouterModule } from '@angular/router'
    import { filter, map } from 'rxjs'
    import { FormsModule } from '@angular/forms'

    import { HeaderComponent } from './pages/header/header.component'
    import { FooterComponent } from './pages/footer/footer.component'

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [
        RouterOutlet,
        RouterModule,
        FormsModule,
        FooterComponent,
        HeaderComponent,
],
    templateUrl: './app.html',
    styleUrls: ['./app.scss', './pages/login/login.component.scss', './pages/dashboard/dashboard.component.scss']
})

export class App {
    protected readonly title = signal('MatchVision');
    private router = inject(Router)

    // The game screen uses the whole height (on phones the footer would cover the pad)
    readonly inGame = toSignal(this.router.events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        map(e => e.urlAfterRedirects.startsWith('/game')),
    ), { initialValue: location.pathname.startsWith('/game') })
}
