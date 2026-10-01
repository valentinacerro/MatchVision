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

// ---------------------------------------------------------------------------------------------
// How a point was won (saved with the rally, see Rally.reason on the server).
// winner: our points vs theirs. gift: the point came from an error or a penalty of the other team.
// choice: picked by the scout after a "+" (the others follow from our touch or from a card).
// ---------------------------------------------------------------------------------------------
export interface PointReason { code: string; team: Team; gift: boolean; choice: boolean; short: string; long: string }

export const POINT_REASONS: PointReason[] = [
    { code: 'serve', team: 'home', gift: false, choice: false, short: 'Ace', long: 'Ace' },
    { code: 'attack', team: 'home', gift: false, choice: false, short: 'Attacco', long: 'Attacco vincente' },
    { code: 'block', team: 'home', gift: false, choice: false, short: 'Muro', long: 'Muro vincente' },
    { code: 'opp_serve_error', team: 'home', gift: true, choice: true, short: 'Battuta', long: 'Errore avversario in battuta' },
    { code: 'opp_attack_error', team: 'home', gift: true, choice: true, short: 'Attacco', long: 'Errore avversario in attacco' },
    { code: 'opp_fault', team: 'home', gift: true, choice: true, short: 'Fallo', long: 'Fallo avversario' },
    { code: 'opp_error', team: 'home', gift: true, choice: true, short: 'Altro', long: 'Errore avversario' },
    { code: 'opp_penalty', team: 'home', gift: true, choice: false, short: 'Cartellino rosso', long: 'Cartellino rosso avversario' },
    { code: 'opp_ace', team: 'guests', gift: false, choice: true, short: 'Ace', long: 'Ace avversario' },
    { code: 'opp_attack', team: 'guests', gift: false, choice: true, short: 'Attacco', long: 'Attacco avversario' },
    { code: 'opp_block', team: 'guests', gift: false, choice: true, short: 'Muro', long: 'Muro avversario' },
    { code: 'opp_point', team: 'guests', gift: false, choice: true, short: 'Altro', long: 'Punto avversario' },
    { code: 'serve_error', team: 'guests', gift: true, choice: false, short: 'Battuta', long: 'Nostro errore in battuta' },
    { code: 'reception_error', team: 'guests', gift: true, choice: false, short: 'Ricezione', long: 'Nostro errore in ricezione' },
    { code: 'set_error', team: 'guests', gift: true, choice: false, short: 'Alzata', long: 'Nostro errore in alzata' },
    { code: 'attack_error', team: 'guests', gift: true, choice: false, short: 'Attacco', long: 'Nostro errore in attacco' },
    { code: 'block_error', team: 'guests', gift: true, choice: false, short: 'Muro', long: 'Nostro errore a muro' },
    { code: 'defense_error', team: 'guests', gift: true, choice: false, short: 'Difesa', long: 'Nostro errore in difesa' },
    { code: 'penalty', team: 'guests', gift: true, choice: false, short: 'Cartellino rosso', long: 'Nostro cartellino rosso' },
]

export function pointReason(code: string | undefined): PointReason | undefined {
    return POINT_REASONS.find(r => r.code === code)
}

// What the scout can pick after a "+" for that team
export function reasonChoices(team: Team): PointReason[] {
    return POINT_REASONS.filter(r => r.team === team && r.choice)
}

const TOUCH_WINNERS: Record<string, string> = { Battuta: 'serve', Attacco: 'attack', Muro: 'block' }
const TOUCH_ERRORS: Record<string, string> = {
    Battuta: 'serve_error', Ricezione: 'reception_error', Alzata: 'set_error',
    Attacco: 'attack_error', Muro: 'block_error', Difesa: 'defense_error',
}

// Reason of a point ended by one of our touches ('' if the touch does not end the rally)
export function touchReason(fundamental: string, outcome: string): string {
    if (outcome === '— —') return TOUCH_ERRORS[fundamental] ?? ''
    if (outcome === '++') return TOUCH_WINNERS[fundamental] ?? ''
    return ''
}

// ---------------------------------------------------------------------------------------------
// Court zones as in DataVolley: 9 squares of 3x3 m per half, seen by the team on that half facing
// the net: 4 3 2 at the net, 7 8 9 in the middle, 5 6 1 at the end line.
// A point in a half: u = 0 at that team's left sideline, 1 at its right; d = 0 at the net, 1 at the end line.
// ---------------------------------------------------------------------------------------------
const ZONE_GRID = [[4, 3, 2], [7, 8, 9], [5, 6, 1]] // [row from the net][column from the left]

export function zoneAt(u: number, d: number): number {
    const third = (v: number) => Math.min(2, Math.max(0, Math.floor(v * 3)))
    return ZONE_GRID[third(d)][third(u)]
}

// Centre of a zone, in the same (u, d) terms
export function zoneCenter(zone: number): { u: number; d: number } {
    const row = ZONE_GRID.findIndex(r => r.includes(zone))
    return { u: (ZONE_GRID[row].indexOf(zone) + 0.5) / 3, d: (row + 0.5) / 3 }
}

// A tap on the opponent's half of the drawing (fx, fy: 0-1 from its top-left corner) seen by the opponent.
// The drawing has the net in the middle: with the opponent on the right half, its net side is on the left
// and, facing the net, its right hand is at the top of the screen (and the other way round on the left half).
export function opponentPoint(fx: number, fy: number, opponentOnRight: boolean): { u: number; d: number } {
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    return opponentOnRight ? { u: clamp(1 - fy), d: clamp(fx) } : { u: clamp(fy), d: clamp(1 - fx) }
}

export type RoleKind = 'setter' | 'outside' | 'middle' | 'opposite' | 'libero' | null

// Roles are saved in Italian from the players page (older data may have the English codes)
export function roleKind(role: string | null | undefined): RoleKind {
    const r = (role ?? '').toLowerCase()
    if (['alzatore', 'palleggiatore', 'setter'].includes(r)) return 'setter'
    if (['lato', 'schiacciatore', 'banda', 'outside_hitter'].includes(r)) return 'outside'
    if (['centrale', 'middle_blocker'].includes(r)) return 'middle'
    if (['opposto', 'opposite_hitter'].includes(r)) return 'opposite'
    if (r === 'libero') return 'libero'
    return null
}

// Position (1-6) of the player at lineup index i, after `rotation` rotations
export function positionOf(i: number, rotation: number): number {
    return ((i - rotation) % 6 + 6) % 6 + 1
}

// Where an attack starts, by the usual switch of positions after the serve: in the front row the outside
// hitter goes to 4, the middle to 3, the opposite (and the setter) to 2; from the back row the attack starts
// in 9 (right), 8 (pipe) or 7 (left), the opposite on the right and the outside hitter in the middle
export function attackStartZone(role: string | null | undefined, position: number): number | null {
    const kind = roleKind(role)
    if (kind === 'libero') return null
    const front = [2, 3, 4].includes(position)
    if (front) {
        if (kind === 'outside') return 4
        if (kind === 'middle') return 3
        if (kind === 'opposite' || kind === 'setter') return 2
        return position
    }
    if (kind === 'opposite') return 9
    if (kind === 'outside') return 8
    return ({ 1: 9, 6: 8, 5: 7 } as Record<number, number>)[position] ?? null
}
