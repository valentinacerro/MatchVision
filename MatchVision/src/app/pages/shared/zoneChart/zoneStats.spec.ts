import { TouchMapEntry } from '../../../services/statsService'
import { zoneStats } from './zoneStats'

const t = (player_id: number, fundamental: string, outcome: string, start_zone: number | null, end_zone: number | null, end_x: number | null = null, end_y: number | null = null): TouchMapEntry =>
    ({ player_id, player__number: player_id, fundamental, outcome, start_zone, end_zone, end_x, end_y })

describe('zoneStats', () => {
    const entries = [
        t(1, 'Attacco', '++', 4, 1, 0.9, 0.8),
        t(1, 'Attacco', '— —', 4, null),
        t(1, 'Attacco', '+', 3, 5, 0.1, 0.9),
        t(2, 'Attacco', '++', 2, 5, 0.2, 0.8),
        t(2, 'Battuta', '++', null, 6, 0.5, 0.9),
    ]

    it('counts where the attacks ended, over those with a zone', () => {
        const s = zoneStats(entries, 'Attacco', null)
        expect([s.total, s.withEnd]).toEqual([4, 3])
        expect(s.ends.find(z => z.zone === 5)).toEqual({ zone: 5, tot: 2, winners: 1, errors: 0, share: 66.7 })
        expect(s.points.length).toBe(3)
    })
    it('gives the setter distribution by start zone, in DataVolley order', () => {
        const s = zoneStats(entries, 'Attacco', null)
        expect(s.starts.map(z => [z.zone, z.tot, z.kills, z.errors, z.hitPct])).toEqual([[4, 2, 1, 1, 0], [3, 1, 0, 0, 0], [2, 1, 1, 0, 100]])
    })
    it('filters by player and fundamental', () => {
        expect(zoneStats(entries, 'Attacco', 2).total).toBe(1)
        const serve = zoneStats(entries, 'Battuta', null)
        expect([serve.total, serve.starts.length, serve.ends.find(z => z.zone === 6)?.tot]).toEqual([1, 0, 1])
    })
})
