import { KpiRow } from '../../../services/statsService'

// Box score of a match or a set, one row per player plus the team, as in DataVolley's match report.
// Everything comes from the KPI rows (counts per player, fundamental and grade).
//
// Reception average on the 0-3 scale: our grades are DataVolley's (++ = #, + = +, ! = !, — = - and /,
// — — = =), and these are the values DataVolley-based stat manuals give them; they agree with the
// 0-3 scale of Hudl (3 perfect, 2 good, 1 poor or overpass, 0 error).
export const RECEPTION_VALUES: Record<string, number> = { '++': 3, '+': 2, '!': 1.5, '—': 1, '— —': 0 }

export interface BoxRow {
    key: string
    number: number | null
    player: string
    team: boolean
    points: number   // kills + aces + block points
    errors: number   // errors in every fundamental (— —)
    balance: number  // points − errors
    serve: { tot: number; aces: number; errors: number }
    reception: { tot: number; avg: number | null; positive: number | null; perfect: number | null }
    attack: { tot: number; kills: number; errors: number; killPct: number | null; hitPct: number | null }
    blocks: number
}

// One decimal, halves away from zero (as the server does for the KPI percentages)
export function pct(part: number, total: number): number | null {
    if (!total) return null
    return Math.sign(part) * Math.floor(Math.abs(part) * 1000 / total + 0.5) / 10
}

function avg(row: KpiRow | undefined): number | null {
    if (!row?.tot) return null
    const sum = Object.entries(RECEPTION_VALUES).reduce((s, [grade, value]) => s + (row[grade as keyof KpiRow] as number) * value, 0)
    return Math.round(sum / row.tot * 100) / 100
}

export function boxScore(rows: KpiRow[]): BoxRow[] {
    const groups = new Map<string, KpiRow[]>()
    for (const r of rows) {
        const key = r.team ? 'team' : String(r.player_id ?? 'none')
        groups.set(key, [...(groups.get(key) ?? []), r])
    }
    const result: BoxRow[] = []
    for (const [key, list] of groups) {
        const of = (f: string) => list.find(r => r.fundamental === f)
        const n = (f: string, grade: keyof KpiRow) => (of(f)?.[grade] as number | undefined) ?? 0
        const serve = { tot: of('Battuta')?.tot ?? 0, aces: n('Battuta', '++'), errors: n('Battuta', '— —') }
        const rec = of('Ricezione')
        const attackTot = of('Attacco')?.tot ?? 0
        const kills = n('Attacco', '++')
        const attackErrors = n('Attacco', '— —')
        const blocks = n('Muro', '++')
        const points = kills + serve.aces + blocks
        const errors = list.reduce((s, r) => s + r['— —'], 0)
        result.push({
            key, number: list[0].number, player: list[0].player, team: key === 'team',
            points, errors, balance: points - errors,
            serve,
            reception: { tot: rec?.tot ?? 0, avg: avg(rec), positive: pct(n('Ricezione', '++') + n('Ricezione', '+'), rec?.tot ?? 0),
                perfect: pct(n('Ricezione', '++'), rec?.tot ?? 0) },
            attack: { tot: attackTot, kills, errors: attackErrors, killPct: pct(kills, attackTot), hitPct: pct(kills - attackErrors, attackTot) },
            blocks,
        })
    }
    // Players by shirt number, touches without a player after them, the team last
    const rank = (r: BoxRow) => r.team ? 2 : r.key === 'none' ? 1 : 0
    return result.sort((a, b) => rank(a) - rank(b) || (a.number ?? 999) - (b.number ?? 999))
}
