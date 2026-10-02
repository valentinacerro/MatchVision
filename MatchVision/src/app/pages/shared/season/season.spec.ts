import { KpiRow } from '../../../services/statsService'
import { isoDate, playerHistory, playerTotal, seasonStart, sumRows } from './season'

const row = (fundamental: string, g: number[], team = false): KpiRow => ({ player_id: team ? null : 7, number: team ? null : 7,
    player: team ? 'Squadra' : 'Ada', team, fundamental, '++': g[0], '+': g[1], '!': g[2], '—': g[3], '— —': g[4],
    tot: g.reduce((a, b) => a + b, 0), positivita: 0, efficienza: 0, errori: 0 })
const info = (id: number, timestamp: string) => ({ id, name: `M${id}`, timestamp, team_id: 1, team_name: 'U16', sets_won: [3, 1] as [number, number] })

describe('season', () => {
    it('adds up the rows of several matches', () => {
        const sum = sumRows([[row('Attacco', [2, 1, 0, 0, 1])], [row('Attacco', [1, 0, 0, 1, 0]), row('Muro', [1, 0, 0, 0, 0])]])
        const attack = sum.find(r => r.fundamental === 'Attacco')!
        expect([attack.tot, attack['++'], attack['— —'], attack.efficienza]).toEqual([6, 3, 1, 33.3])
        expect(sum.length).toBe(2)
    })
    it('gives a player line per match and the total', () => {
        const entries = [{ match: info(1, '2026-09-10T18:00:00Z'), rows: [row('Attacco', [2, 0, 0, 0, 1])] },
                         { match: info(2, '2026-10-05T18:00:00Z'), rows: [row('Attacco', [1, 0, 0, 0, 0]), row('Battuta', [1, 0, 0, 0, 0])] }]
        expect(playerHistory(entries).map(l => l.box.points)).toEqual([2, 2])
        const total = playerTotal(entries)!
        expect([total.points, total.attack.tot, total.attack.hitPct]).toEqual([4, 4, 50])
    })
    it('starts the season on 1 September', () => {
        expect(isoDate(seasonStart(new Date(2026, 9, 1)))).toBe('2026-09-01')
        expect(isoDate(seasonStart(new Date(2027, 2, 15)))).toBe('2026-09-01')
        expect(isoDate(seasonStart(new Date(2026, 7, 31)))).toBe('2025-09-01')
    })
})
