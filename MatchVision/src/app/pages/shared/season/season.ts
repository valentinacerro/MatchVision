import { KpiRow, PlayerHistoryEntry, SeasonStats } from '../../../services/statsService'
import { BoxRow, boxScore, pct } from '../kpiView/boxScore'

const GRADES = ['++', '+', '!', '—', '— —'] as const

// KPI rows of several matches added up (same player and fundamental), with the percentages recomputed
export function sumRows(lists: KpiRow[][]): KpiRow[] {
    const sums = new Map<string, KpiRow>()
    for (const row of lists.flat()) {
        const key = `${row.team ? 'team' : row.player_id ?? 'none'}|${row.fundamental}`
        const sum = sums.get(key) ?? { ...row, '++': 0, '+': 0, '!': 0, '—': 0, '— —': 0, tot: 0 }
        for (const g of GRADES) sum[g] += row[g]
        sum.tot += row.tot
        sums.set(key, sum)
    }
    return [...sums.values()].map(r => ({ ...r,
        positivita: pct(r['++'] + r['+'], r.tot) ?? 0, efficienza: pct(r['++'] - r['— —'], r.tot) ?? 0, errori: pct(r['— —'], r.tot) ?? 0 }))
}

// One match of a season: the team's box score line, with side-out and break-point
export interface TrendLine { id: number; name: string; date: Date; setsWon: [number, number]; box: BoxRow | null; sideout: number | null; breakpoint: number | null }

export function seasonTrend(stats: SeasonStats): TrendLine[] {
    return stats.trend.map(m => ({ id: m.id, name: m.name, date: new Date(m.timestamp), setsWon: m.sets_won,
        box: boxScore(m.team_rows).find(r => r.team) ?? null, sideout: m.sideout, breakpoint: m.breakpoint }))
}

// One match of a player: his box score line in that match
export interface HistoryLine { id: number; name: string; team: string; date: Date; setsWon: [number, number]; box: BoxRow }

export function playerHistory(entries: PlayerHistoryEntry[]): HistoryLine[] {
    return entries.map(e => ({ id: e.match.id, name: e.match.name, team: e.match.team_name, date: new Date(e.match.timestamp),
        setsWon: e.match.sets_won, box: boxScore(e.rows).find(r => !r.team)! })).filter(l => !!l.box)
}

// The player's line over all the matches of the history
export function playerTotal(entries: PlayerHistoryEntry[]): BoxRow | null {
    return boxScore(sumRows(entries.map(e => e.rows))).find(r => !r.team) ?? null
}

// Volleyball seasons start in September: 2026/27 runs from 1 September 2026
export function seasonStart(today: Date): Date {
    const year = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1
    return new Date(year, 8, 1)
}

// YYYY-MM-DD in local time (what the server filters on)
export function isoDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
