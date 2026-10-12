export type TContract = { contract_type: string; label: string; tone: 'up' | 'down' | 'neutral' };

export type TTradeType = {
    key: string;
    label: string;
    available: boolean;
    contracts: TContract[];
    min_ticks: number;
    has_barrier?: boolean;
    barrier_min?: number;
    barrier_max?: number;
};

// Trade types supported by this screen. Others are listed as "Coming soon".
export const TRADE_TYPES: TTradeType[] = [
    {
        key: 'accumulators',
        label: 'Accumulators',
        available: true,
        min_ticks: 1,
        contracts: [{ contract_type: 'ACCU', label: 'Buy', tone: 'neutral' }],
    },
    {
        key: 'rise_fall',
        label: 'Rise/Fall',
        available: true,
        min_ticks: 5,
        contracts: [
            { contract_type: 'CALL', label: 'Rise', tone: 'up' },
            { contract_type: 'PUT', label: 'Fall', tone: 'down' },
        ],
    },
    {
        key: 'even_odd',
        label: 'Even/Odd',
        available: true,
        min_ticks: 1,
        contracts: [
            { contract_type: 'DIGITEVEN', label: 'Even', tone: 'up' },
            { contract_type: 'DIGITODD', label: 'Odd', tone: 'down' },
        ],
    },
    {
        key: 'matches_differs',
        label: 'Matches/Differs',
        available: true,
        min_ticks: 1,
        has_barrier: true,
        barrier_min: 0,
        barrier_max: 9,
        contracts: [
            { contract_type: 'DIGITMATCH', label: 'Matches', tone: 'up' },
            { contract_type: 'DIGITDIFF', label: 'Differs', tone: 'down' },
        ],
    },
    {
        key: 'over_under',
        label: 'Over/Under',
        available: true,
        min_ticks: 1,
        has_barrier: true,
        barrier_min: 1,
        barrier_max: 8,
        contracts: [
            { contract_type: 'DIGITOVER', label: 'Over', tone: 'up' },
            { contract_type: 'DIGITUNDER', label: 'Under', tone: 'down' },
        ],
    },
    { key: 'multipliers', label: 'Multipliers', available: false, min_ticks: 1, contracts: [] },
    { key: 'higher_lower', label: 'Higher/Lower', available: false, min_ticks: 1, contracts: [] },
    { key: 'touch', label: 'Touch/No Touch', available: false, min_ticks: 1, contracts: [] },
    { key: 'vanillas', label: 'Vanillas', available: false, min_ticks: 1, contracts: [] },
    { key: 'turbos', label: 'Turbos', available: false, min_ticks: 1, contracts: [] },
];

export const getTradeType = (key: string): TTradeType => TRADE_TYPES.find(t => t.key === key) || TRADE_TYPES[0];
