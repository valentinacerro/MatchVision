export enum FundamentalType {
    SERVE = 'Serve',
    SERVE_RECEIVE = 'Serve_Receive',
    SET = 'Set',
    SPIKE = 'Spike',
    BLOCK = 'Block',
    DEFENSE = 'Defense'
}

export enum TouchResult {
    POSITIVA = 'Positiva',
    BUONA = 'Buona',
    NEUTRA = 'Neutra',
    NEGATIVA = 'Negativa',
    ERRORE = 'Errore',
}

export class Touch {
    constructor(
        public id: number,
        public set: number,
        public fundamental: FundamentalType | string,
        public outcome: TouchResult | string,
        public player: number,
        public client_id?: string, // same id on a retry, so the server does not save it twice
        // DataVolley zones (1-9) and the exact end point in the other half (0-1, seen by the team there)
        public start_zone?: number | null,
        public end_zone?: number | null,
        public end_x?: number | null,
        public end_y?: number | null
    ) {}
}