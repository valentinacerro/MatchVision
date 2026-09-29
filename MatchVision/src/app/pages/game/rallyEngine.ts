// Volleyball rules used by the live game screen. Pure functions, no Angular: easy to test.
// 'home' is the scouted team (CASA); only its touches are recorded.

export type Team = 'home' | 'guests'

export interface Score { home: number; guests: number }

export interface MatchFormat {
    setsToWin: number      // 3 = best of 5, 2 = best of 3
    setPoints: number      // 25 (or 21)
    tiebreakPoints: number // 15, for the deciding set
}

export const DEFAULT_FORMAT: MatchFormat = { setsToWin: 3, setPoints: 25, tiebreakPoints: 15 }

// Serving team and rotation of the home team (0..5, +1 at every side-out won)
export interface RallyState { serving: Team; rotation: number }

// Who wins the rally because of this touch, or null if the rally goes on.
// '— —' is always a point lost; '++' is a point won only for the skills that can score.
export function terminalWinner(fundamental: string, outcome: string): Team | null {
    if (outcome === '— —') return 'guests'
    if (outcome === '++' && ['Battuta', 'Attacco', 'Muro'].includes(fundamental)) return 'home'
    return null
}

// State after a rally won by `winner`: the home team rotates only when it wins on the opponent's serve
export function afterPoint(state: RallyState, winner: Team): RallyState & { rotated: boolean } {
    const rotated = winner === 'home' && state.serving === 'guests'
    return {
        serving: winner,
        rotation: rotated ? (state.rotation + 1) % 6 : state.rotation,
        rotated,
    }
}

// Index in the lineup of the player in position 1 (the server). The lineup is in position order
// P1..P6 at rotation 0, and each rotation moves every player one position back.
export function serverIndex(rotation: number): number {
    return ((rotation % 6) + 6) % 6
}

export function isDecidingSet(setNumber: number, format: MatchFormat): boolean {
    return setNumber === format.setsToWin * 2 - 1
}

export function pointsToWinSet(setNumber: number, format: MatchFormat): number {
    return isDecidingSet(setNumber, format) ? format.tiebreakPoints : format.setPoints
}

// Winner of the set with this score, if the set is over (target reached with a 2-point lead)
export function setWinner(score: Score, setNumber: number, format: MatchFormat): Team | null {
    const target = pointsToWinSet(setNumber, format)
    if (score.home >= target && score.home - score.guests >= 2) return 'home'
    if (score.guests >= target && score.guests - score.home >= 2) return 'guests'
    return null
}

export function setsWon(results: { home_score: number; guest_score: number }[]): Score {
    return {
        home: results.filter(r => r.home_score > r.guest_score).length,
        guests: results.filter(r => r.guest_score > r.home_score).length,
    }
}

export function matchWinner(results: { home_score: number; guest_score: number }[], format: MatchFormat): Team | null {
    const won = setsWon(results)
    if (won.home >= format.setsToWin) return 'home'
    if (won.guests >= format.setsToWin) return 'guests'
    return null
}

// In the deciding set the teams change sides when the leading team reaches 8 (of 15)
export function sideSwitchDue(score: Score, setNumber: number, format: MatchFormat): boolean {
    if (!isDecidingSet(setNumber, format)) return false
    const half = Math.ceil(format.tiebreakPoints / 2)
    return Math.max(score.home, score.guests) === half
}

// Most likely next touch of the home team, given who serves and the home touches of this rally.
// `solo`: only serve, reception and attack are scouted.
export function suggestFundamental(serving: Team, rallyFundamentals: string[], solo: boolean): string {
    const last = rallyFundamentals.at(-1)
    if (!last) return serving === 'home' ? 'Battuta' : 'Ricezione'
    if (solo) return 'Attacco'
    const next: { [f: string]: string } = {
        Battuta: 'Muro',      // the opponent receives and attacks: first our block (as after our attack)
        Ricezione: 'Alzata',
        Difesa: 'Alzata',
        Alzata: 'Attacco',
        Attacco: 'Muro',      // the ball comes back: first our block
        Muro: 'Difesa',
    }
    return next[last] ?? ''
}
