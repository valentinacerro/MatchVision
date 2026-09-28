export class Match {
    constructor(
        public id: number,
        public name: string,
        public team_id: number,
        public timestamp: Date,
        public result: string | null,
        // Match format (sets to win, points per set, deciding set)
        public sets_to_win?: number,
        public set_points?: number,
        public tiebreak_points?: number
    ) {}
}