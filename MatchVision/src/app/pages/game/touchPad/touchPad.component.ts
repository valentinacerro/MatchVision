import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core'
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
export class TouchPadComponent implements OnChanges {

    @Input() player: Player | null = null
    @Input() disabled: boolean = false
    @Input() isLibero: boolean = false // the libero may not serve or block
    @Input() manualPick: number = 0    // changes when the scout taps a player: a deliberate new touch
    // Most likely next fundamental for each profile; a new object means "apply it now"
    @Input() suggestion: { completo: string; solo: string; id: number } | null = null
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
    private lastSave = 0

    suggested = false // the selected fundamental comes from the suggestion

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['player']) this.hint = ''
        // The scout picked a player on purpose: the next grade tap is a new touch, not a double tap
        if (changes['manualPick'] && !changes['manualPick'].firstChange) this.lastSave = 0
        if (changes['isLibero'] && this.isLibero && this.forbidden(this.fundamental)) {
            this.fundamental = ''
            this.suggested = false
        }
        // A closed set starts the next one clean
        if (changes['disabled'] && this.disabled) {
            this.fundamental = ''
            this.hint = ''
            this.suggested = false
        }
        if ((changes['suggestion'] || (changes['disabled'] && !this.disabled)) && !this.disabled) this.applySuggestion()
    }

    private applySuggestion(): void {
        // Never replace a fundamental the scout picked
        if (this.fundamental && !this.suggested) return
        const f = this.profile === 'solo' ? this.suggestion?.solo : this.suggestion?.completo
        if (f && this.fundamentals.includes(f) && !this.forbidden(f)) {
            this.fundamental = f
            this.suggested = true
        } else if (this.suggested) {
            this.fundamental = ''
            this.suggested = false
        }
    }

    get fundamentals(): string[] {
        return this.profile === 'solo' ? SOLO_FUNDAMENTALS : ALL_FUNDAMENTALS
    }

    setProfile(profile: 'solo' | 'completo'): void {
        this.profile = profile
        if (!this.fundamentals.includes(this.fundamental)) this.fundamental = ''
        if (this.suggested || !this.fundamental) this.applySuggestion()
        try { localStorage.setItem(PROFILE_KEY, profile) } catch {}
    }

    selectFundamental(f: string): void {
        this.fundamental = this.fundamental === f ? '' : f
        this.suggested = false
        this.hint = ''
    }

    forbidden(f: string): boolean {
        return this.isLibero && (f === 'Battuta' || f === 'Muro')
    }

    selectGrade(outcome: string): void {
        // A second tap right after a save is a double tap: ignore it, even if a player is preselected
        if (Date.now() - this.lastSave < 600) return
        if (this.disabled) return
        if (!this.player) {
            // A second tap right after a save is a double tap, not a mistake: no hint
            if (Date.now() - this.lastSave > 700) this.hint = 'Tocca prima un giocatore in campo'
            return
        }
        if (!this.fundamental) {
            this.hint = 'Scegli il fondamentale'
            return
        }
        if (this.forbidden(this.fundamental)) {
            this.hint = 'Il libero non può battere né murare'
            return
        }
        this.touchEntered.emit({ fundamental: this.fundamental, outcome })
        this.fundamental = ''
        this.suggested = false
        this.hint = ''
        this.lastSave = Date.now()
    }

    private loadProfile(): 'solo' | 'completo' {
        try { return localStorage.getItem(PROFILE_KEY) === 'completo' ? 'completo' : 'solo' } catch { return 'solo' }
    }
}
