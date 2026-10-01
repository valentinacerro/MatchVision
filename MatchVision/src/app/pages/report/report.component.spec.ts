import { KpiRow, RallyStats } from '../../services/statsService'
import { setLine } from './report.component'

describe('setLine', () => {
    it('summarises a set for the report', () => {
        const team = (fundamental: string, g: number[]): KpiRow => ({ player_id: null, number: null, player: 'Squadra', team: true, fundamental,
            '++': g[0], '+': g[1], '!': g[2], '—': g[3], '— —': g[4], tot: g.reduce((a, b) => a + b, 0), positivita: 0, efficienza: 0, errori: 0 })
        const rows = [team('Battuta', [2, 5, 3, 0, 1]), team('Attacco', [6, 4, 2, 1, 3])]
        const rallies = { total: 44, sideout: { won: 12, total: 20, pct: 60 }, breakpoint: { won: 13, total: 24, pct: 54.2 }, rotations: [],
            points: { home: { total: 25, gifted: 4, unspecified: 0, reasons: {} }, guests: { total: 19, gifted: 4, unspecified: 0, reasons: {} } } } as RallyStats
        const line = setLine({ id: 1, match: 1, number: 2, home_score: 25, guest_score: 19, players: [], player_ids: [] }, rows, rallies)
        expect(line).toEqual({ number: 2, home: 25, guests: 19, sideout: 60, breakpoint: 54.2, hitPct: 18.8, aces: 2, errors: 4, gifted: [4, 4] })
    })
})
