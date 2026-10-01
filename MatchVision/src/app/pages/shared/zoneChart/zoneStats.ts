import { TouchMapEntry } from '../../../services/statsService'
import { pct } from '../kpiView/boxScore'

export interface ZoneCount { zone: number; tot: number; winners: number; errors: number; share: number | null }
export interface StartZone { zone: number; tot: number; share: number | null; kills: number; errors: number; killPct: number | null; hitPct: number | null }
export interface ZoneStats {
    total: number            // serves or attacks of the selection
    withEnd: number          // of which with the end point tapped
    ends: ZoneCount[]        // where they ended, zones 1-9
    starts: StartZone[]      // attacks only: where they started (the setter's distribution)
    points: { u: number; d: number; outcome: string; start: number | null }[]
}

// Zones of the serves or attacks of a player (or of the team, player null)
export function zoneStats(entries: TouchMapEntry[], fundamental: string, player: number | null): ZoneStats {
    const list = entries.filter(e => e.fundamental === fundamental && (player === null || e.player_id === player))
    const withEnd = list.filter(e => e.end_zone)
    const ends: ZoneCount[] = []
    for (let zone = 1; zone <= 9; zone++) {
        const here = withEnd.filter(e => e.end_zone === zone)
        ends.push({ zone, tot: here.length, winners: here.filter(e => e.outcome === '++').length,
            errors: here.filter(e => e.outcome === '— —').length, share: pct(here.length, withEnd.length) })
    }
    const starts: StartZone[] = []
    for (const zone of [4, 3, 2, 7, 8, 9, 5, 6, 1]) {
        const here = list.filter(e => e.start_zone === zone)
        if (!here.length) continue
        const kills = here.filter(e => e.outcome === '++').length
        const errors = here.filter(e => e.outcome === '— —').length
        starts.push({ zone, tot: here.length, share: pct(here.length, list.length), kills, errors,
            killPct: pct(kills, here.length), hitPct: pct(kills - errors, here.length) })
    }
    return {
        total: list.length, withEnd: withEnd.length, ends, starts,
        points: withEnd.filter(e => e.end_x !== null && e.end_y !== null)
            .map(e => ({ u: e.end_x as number, d: e.end_y as number, outcome: e.outcome, start: e.start_zone })),
    }
}
