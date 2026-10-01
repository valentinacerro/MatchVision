import { KpiRow } from '../../../services/statsService'
import { boxScore, pct } from './boxScore'

function row(player_id: number | null, number: number | null, fundamental: string, grades: number[], team = false): KpiRow {
    const [pp, p, n, m, mm] = grades
    const tot = pp + p + n + m + mm
    return { player_id, number, player: team ? 'Squadra' : `G${number}`, team, fundamental,
        '++': pp, '+': p, '!': n, '—': m, '— —': mm, tot, positivita: 0, efficienza: 0, errori: 0 }
}

describe('boxScore', () => {
    const rows = [
        row(1, 7, 'Battuta', [2, 3, 0, 0, 1]),
        row(1, 7, 'Attacco', [5, 2, 1, 1, 2]),   // 11 attempts, 5 kills, 2 errors
        row(1, 7, 'Muro', [1, 0, 0, 0, 0]),
        row(2, 4, 'Ricezione', [4, 3, 2, 1, 0]), // (12 + 6 + 3 + 1) / 10 = 2.2
        row(2, 4, 'Difesa', [0, 1, 0, 0, 1]),
        row(null, null, 'Battuta', [1, 0, 0, 0, 0], true),
    ]
    const box = boxScore(rows)
    const g7 = box.find(r => r.number === 7)!
    const g4 = box.find(r => r.number === 4)!

    it('counts points, errors and the balance like DataVolley', () => {
        expect([g7.points, g7.errors, g7.balance]).toEqual([8, 3, 5]) // 5 kills + 2 aces + 1 block; 1 + 2 errors
        expect([g4.points, g4.errors, g4.balance]).toEqual([0, 1, -1])
    })
    it('computes attack percentages', () => {
        expect(g7.attack).toEqual({ tot: 11, kills: 5, errors: 2, killPct: 45.5, hitPct: 27.3 })
        expect(g4.attack.hitPct).toBeNull()
    })
    it('rates the reception on the 0-3 scale', () => {
        expect(g4.reception).toEqual({ tot: 10, avg: 2.2, positive: 70, perfect: 40 })
    })
    it('orders players by number with the team last', () => {
        expect(box.map(r => r.number ?? r.player)).toEqual([4, 7, 'Squadra'])
    })
    it('rounds halves away from zero', () => {
        expect(pct(1, 16)).toBe(6.3)
        expect(pct(-1, 16)).toBe(-6.3)
        expect(pct(1, 0)).toBeNull()
    })
})
