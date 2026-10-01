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
        public tiebreak_points?: number,
        public results?: { home_score: number; guest_score: number }[],
        // Saved while the match is being scouted, null when not started or over
        public live_state?: any,
        // Created on this device without a connection: not on the server yet (temporary negative id)
        public local?: boolean
    ) {}
}