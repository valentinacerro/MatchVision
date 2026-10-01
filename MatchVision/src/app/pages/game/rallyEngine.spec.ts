import {
    afterPoint, attackStartZone, DEFAULT_FORMAT, opponentPoint, positionOf, roleKind, zoneAt, zoneCenter, isDecidingSet, matchWinner, POINT_REASONS, pointReason, pointsToWinSet, reasonChoices,
    serverIndex, setWinner, sideSwitchDue, suggestFundamental, terminalWinner, touchReason,
} from './rallyEngine'

describe('rallyEngine', () => {

    describe('terminalWinner', () => {
        it('gives the point to home for an ace, a kill or a stuff block', () => {
            expect(terminalWinner('Battuta', '++')).toBe('home')
            expect(terminalWinner('Attacco', '++')).toBe('home')
            expect(terminalWinner('Muro', '++')).toBe('home')
        })
        it('gives the point to the opponent for any error', () => {
            for (const f of ['Battuta', 'Ricezione', 'Alzata', 'Attacco', 'Muro', 'Difesa'])
                expect(terminalWinner(f, '— —')).toBe('guests')
        })
        it('keeps the rally going otherwise', () => {
            expect(terminalWinner('Ricezione', '++')).toBeNull()
            expect(terminalWinner('Alzata', '++')).toBeNull()
            expect(terminalWinner('Difesa', '++')).toBeNull()
            expect(terminalWinner('Attacco', '+')).toBeNull()
            expect(terminalWinner('Battuta', '!')).toBeNull()
            expect(terminalWinner('Attacco', '—')).toBeNull()
        })
    })

    describe('afterPoint', () => {
        it('rotates home only on a side-out', () => {
            expect(afterPoint({ serving: 'guests', rotation: 0 }, 'home')).toEqual({ serving: 'home', rotation: 1, rotated: true })
            expect(afterPoint({ serving: 'home', rotation: 1 }, 'home')).toEqual({ serving: 'home', rotation: 1, rotated: false })
        })
        it('passes the serve to the opponent when home loses the rally', () => {
            expect(afterPoint({ serving: 'home', rotation: 3 }, 'guests')).toEqual({ serving: 'guests', rotation: 3, rotated: false })
            expect(afterPoint({ serving: 'guests', rotation: 3 }, 'guests')).toEqual({ serving: 'guests', rotation: 3, rotated: false })
        })
        it('wraps the rotation after position 6', () => {
            expect(afterPoint({ serving: 'guests', rotation: 5 }, 'home').rotation).toBe(0)
        })
    })

    it('finds the server in the lineup', () => {
        expect(serverIndex(0)).toBe(0)
        expect(serverIndex(1)).toBe(1)
        expect(serverIndex(5)).toBe(5)
        expect(serverIndex(6)).toBe(0)
    })

    describe('set and match rules', () => {
        const best3 = { setsToWin: 2, setPoints: 25, tiebreakPoints: 15 }

        it('knows the deciding set and its points', () => {
            expect(isDecidingSet(5, DEFAULT_FORMAT)).toBeTrue()
            expect(isDecidingSet(4, DEFAULT_FORMAT)).toBeFalse()
            expect(isDecidingSet(3, best3)).toBeTrue()
            expect(pointsToWinSet(1, DEFAULT_FORMAT)).toBe(25)
            expect(pointsToWinSet(5, DEFAULT_FORMAT)).toBe(15)
        })
        it('needs the target and a two-point lead', () => {
            expect(setWinner({ home: 25, guests: 23 }, 1, DEFAULT_FORMAT)).toBe('home')
            expect(setWinner({ home: 25, guests: 24 }, 1, DEFAULT_FORMAT)).toBeNull()
            expect(setWinner({ home: 26, guests: 28 }, 1, DEFAULT_FORMAT)).toBe('guests')
            expect(setWinner({ home: 24, guests: 20 }, 1, DEFAULT_FORMAT)).toBeNull()
            expect(setWinner({ home: 15, guests: 13 }, 5, DEFAULT_FORMAT)).toBe('home')
            expect(setWinner({ home: 15, guests: 13 }, 4, DEFAULT_FORMAT)).toBeNull()
        })
        it('ends the match when a team wins enough sets', () => {
            const r = (h: number, g: number) => ({ home_score: h, guest_score: g })
            expect(matchWinner([r(25, 20), r(25, 22)], DEFAULT_FORMAT)).toBeNull()
            expect(matchWinner([r(25, 20), r(20, 25), r(25, 22), r(25, 18)], DEFAULT_FORMAT)).toBe('home')
            expect(matchWinner([r(20, 25), r(22, 25)], best3)).toBe('guests')
        })
        it('switches sides at 8 in the deciding set only', () => {
            expect(sideSwitchDue({ home: 8, guests: 5 }, 5, DEFAULT_FORMAT)).toBeTrue()
            expect(sideSwitchDue({ home: 7, guests: 5 }, 5, DEFAULT_FORMAT)).toBeFalse()
            expect(sideSwitchDue({ home: 8, guests: 5 }, 4, DEFAULT_FORMAT)).toBeFalse()
        })
    })

    describe('suggestFundamental', () => {
        it('starts the rally with serve or reception', () => {
            expect(suggestFundamental('home', [], false)).toBe('Battuta')
            expect(suggestFundamental('guests', [], true)).toBe('Ricezione')
        })
        it('follows the order of play in the full profile', () => {
            expect(suggestFundamental('guests', ['Ricezione'], false)).toBe('Alzata')
            expect(suggestFundamental('guests', ['Ricezione', 'Alzata'], false)).toBe('Attacco')
            expect(suggestFundamental('home', ['Battuta'], false)).toBe('Muro')
            expect(suggestFundamental('home', ['Battuta', 'Muro'], false)).toBe('Difesa')
            expect(suggestFundamental('guests', ['Ricezione', 'Alzata', 'Attacco'], false)).toBe('Muro')
        })
        it('suggests the attack after the first touch in the solo profile', () => {
            expect(suggestFundamental('guests', ['Ricezione'], true)).toBe('Attacco')
            expect(suggestFundamental('home', ['Battuta'], true)).toBe('Attacco')
        })
    })

    describe('point reasons', () => {
        it('follow from the touch that ended the rally', () => {
            expect(touchReason('Battuta', '++')).toBe('serve')
            expect(touchReason('Attacco', '++')).toBe('attack')
            expect(touchReason('Ricezione', '— —')).toBe('reception_error')
            expect(touchReason('Ricezione', '++')).toBe('')
        })
        it('agree with the winner of the point', () => {
            for (const f of ['Battuta', 'Ricezione', 'Alzata', 'Attacco', 'Muro', 'Difesa'])
                for (const g of ['++', '— —']) {
                    const code = touchReason(f, g)
                    if (code) expect(pointReason(code)?.team).toBe(terminalWinner(f, g) as any)
                }
        })
        it('offer four choices for each team, opponent errors for our points', () => {
            expect(reasonChoices('home').map(r => r.short)).toEqual(['Battuta', 'Attacco', 'Fallo', 'Altro'])
            expect(reasonChoices('home').every(r => r.gift)).toBeTrue()
            expect(reasonChoices('guests').map(r => r.short)).toEqual(['Ace', 'Attacco', 'Muro', 'Altro'])
            expect(new Set(POINT_REASONS.map(r => r.code)).size).toBe(POINT_REASONS.length)
        })
    })

    describe('court zones', () => {
        it('numbers the zones as DataVolley, seen by the team on that half', () => {
            expect([zoneAt(0.1, 0.1), zoneAt(0.5, 0.1), zoneAt(0.9, 0.1)]).toEqual([4, 3, 2])
            expect([zoneAt(0.1, 0.5), zoneAt(0.5, 0.5), zoneAt(0.9, 0.5)]).toEqual([7, 8, 9])
            expect([zoneAt(0.1, 0.9), zoneAt(0.5, 0.9), zoneAt(0.9, 0.9)]).toEqual([5, 6, 1])
            expect(zoneAt(1, 1)).toBe(1)
            expect(zoneCenter(1)).toEqual({ u: 2.5 / 3, d: 2.5 / 3 })
        })
        it('reads a tap on the opponent half from the opponent side', () => {
            // Opponent on the right half: top-right corner of that half = its back right = zone 1
            expect(zoneAt(...xy(opponentPoint(0.95, 0.05, true)))).toBe(1)
            // and near the net at the bottom = its front left = zone 4
            expect(zoneAt(...xy(opponentPoint(0.05, 0.95, true)))).toBe(4)
            // Opponent on the left half: bottom-left corner = its back right = zone 1
            expect(zoneAt(...xy(opponentPoint(0.05, 0.95, false)))).toBe(1)
            expect(zoneAt(...xy(opponentPoint(0.95, 0.05, false)))).toBe(4)
        })
        it('knows the positions after a rotation', () => {
            expect([0, 1, 2, 3, 4, 5].map(i => positionOf(i, 0))).toEqual([1, 2, 3, 4, 5, 6])
            expect(positionOf(1, 1)).toBe(1) // the player in II serves after one side-out
            expect(positionOf(0, 1)).toBe(6)
        })
        it('guesses the attack start zone from role and position', () => {
            expect(roleKind('Lato')).toBe('outside')
            expect(roleKind('MIDDLE_BLOCKER')).toBe('middle')
            expect(attackStartZone('Lato', 2)).toBe(4)       // front row: outside hitters attack from 4
            expect(attackStartZone('Centrale', 4)).toBe(3)
            expect(attackStartZone('Opposto', 3)).toBe(2)
            expect(attackStartZone('Opposto', 6)).toBe(9)    // back row
            expect(attackStartZone('Lato', 5)).toBe(8)       // pipe
            expect(attackStartZone('', 5)).toBe(7)
            expect(attackStartZone('', 3)).toBe(3)
            expect(attackStartZone('Libero', 6)).toBeNull()
        })
    })
})

function xy(p: { u: number; d: number }): [number, number] {
    return [p.u, p.d]
}
