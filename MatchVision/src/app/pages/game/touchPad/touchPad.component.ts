import { Component, EventEmitter, Input, Output } from '@angular/core'
import { Player } from '../../../Models/Player'

export const ALL_FUNDAMENTALS = ['Battuta', 'Ricezione', 'Alzata', 'Attacco', 'Muro', 'Difesa']
// What one scout can reliably follow live: serve, reception, attack
const SOLO_FUNDAMENTALS = ['Battuta', 'Ricezione', 'Attacco']
const PROFILE_KEY = 'matchvision.profile'

// Always-visible input next to the court: player (on the court), fundamental, grade.
// The touch is saved on the grade tap.
@Component({
    selector: 'app-touch-pad',
    standalone: true,
    templateUrl: './touchPad.component.html',
    styleUrls: ['./touchPad.component.scss']
})
export class TouchPadComponent {

    @Input() player: Player | null = null
    @Input() disabled: boolean = false
    @Output() touchEntered = new EventEmitter<{fundamental: string; outcome: string}>()
    @Output() statsRequested = new EventEmitter<void>()

    readonly grades = [
        { value: '++', label: 'perfetto', css: 'grade-pp' },
        { value: '+', label: 'positivo', css: 'grade-p' },
        { value: '!', label: 'neutro', css: 'grade-n' },
        { value: '—', label: 'negativo', css: 'grade-m' },
        { value: '— —', label: 'errore', css: 'grade-mm' },
    ]

    profile: 'solo' | 'completo' = this.loadProfile()
    fundamental = ''
    hint = ''

    get fundamentals(): string[] {
        return this.profile === 'solo' ? SOLO_FUNDAMENTALS : ALL_FUNDAMENTALS
    }

    setProfile(profile: 'solo' | 'completo'): void {
        this.profile = profile
        if (!this.fundamentals.includes(this.fundamental)) this.fundamental = ''
        try { localStorage.setItem(PROFILE_KEY, profile) } catch {}
    }

    selectFundamental(f: string): void {
        this.fundamental = this.fundamental === f ? '' : f
        this.hint = ''
    }

    selectGrade(outcome: string): void {
        if (this.disabled) return
        if (!this.player) {
            this.hint = 'Tocca prima un giocatore in campo'
            return
        }
        if (!this.fundamental) {
            this.hint = 'Scegli il fondamentale'
            return
        }
        this.touchEntered.emit({ fundamental: this.fundamental, outcome })
        this.fundamental = ''
        this.hint = ''
    }

    private loadProfile(): 'solo' | 'completo' {
        try { return localStorage.getItem(PROFILE_KEY) === 'completo' ? 'completo' : 'solo' } catch { return 'solo' }
    }
}
