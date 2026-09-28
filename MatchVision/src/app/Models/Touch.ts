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
        public client_id?: string // same id on a retry, so the server does not save it twice
    ) {}
}