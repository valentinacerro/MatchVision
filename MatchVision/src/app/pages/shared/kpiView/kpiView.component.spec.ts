import { pointsView } from './kpiView.component'

describe('pointsView', () => {
    it('groups the points of each team by how they were won', () => {
        const zero = { total: 0, gifted: 0, unspecified: 0, reasons: {} }
        const view = pointsView({
            total: 6, sideout: { won: 0, total: 0, pct: null }, breakpoint: { won: 0, total: 0, pct: null }, rotations: [],
            points: {
                home: { total: 4, gifted: 1, unspecified: 1, reasons: { attack: 2, opp_serve_error: 1 } },
                guests: { ...zero, total: 2, gifted: 1, reasons: { opp_ace: 1, reception_error: 1 } },
            },
        })
        expect(view.map(t => [t.label, t.total, t.unspecified])).toEqual([['CASA', 4, 1], ['OSPITI', 2, 0]])
        expect(view[0].groups.map(g => [g.label, g.total])).toEqual([['Nostri punti vincenti', 2], ['Errori avversari', 1]])
        expect(view[0].groups[0].items).toEqual([{ label: 'Attacco', count: 2 }])
        expect(view[1].groups[1].items).toEqual([{ label: 'Ricezione', count: 1 }])
        expect(pointsView(null)).toEqual([])
    })
})
