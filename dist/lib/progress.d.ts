export type ProgressBucket = 'shipped' | 'beta' | 'alpha' | 'planned' | 'parked';
export type ProgressCount = {
    shipped: number;
    beta: number;
    alpha: number;
    planned: number;
    parked: number;
    total: number;
    total_active: number;
    pct_shipped: number;
    pct_beta: number;
    pct_alpha: number;
    pct_planned: number;
};
export type ProgressAggregate = {
    all: ProgressCount;
    bySource: Record<string, ProgressCount>;
};
export type ProgressSnapshot = {
    capability: ProgressAggregate;
    delivery: ProgressAggregate;
    backlog: ProgressAggregate;
    byTable: Record<string, ProgressAggregate>;
};
type Row = Record<string, string>;
export declare function computeProgress(tables: Record<string, {
    headers: string[];
    rows: Row[];
}>): ProgressSnapshot;
export {};
