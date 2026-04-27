function stripDate(value) {
    return value.replace(/\s*\([^)]*\)\s*$/, '').trim();
}
function phaseParked(row) {
    return String(row.Phase || '').trim().toLowerCase() === 'parked';
}
function classifySubfeatureStatus(value) {
    const v = stripDate(value).toLowerCase();
    if (!v)
        return null;
    if (v === 'landed' || v === 'done' || v === 'implemented' || v === 'shipped')
        return 'shipped';
    if (v === 'active' || v === 'review' || v === 'in review' || v === 'alpha' || v === 'started' || v === 'in progress')
        return 'alpha';
    if (v === 'queued' || v === 'planned' || v === 'open')
        return 'planned';
    if (v === 'blocked')
        return 'alpha';
    if (v === 'deferred' || v === 'parked')
        return 'parked';
    return null;
}
function classifyBacklogStatus(value) {
    const v = stripDate(value).toLowerCase();
    if (!v)
        return null;
    if (v === 'done' || v === 'resolved' || v === 'closed')
        return 'shipped';
    if (v === 'active' || v === 'started' || v === 'in progress' || v === 'drafted')
        return 'alpha';
    if (v === 'blocked')
        return 'alpha';
    if (v === 'open' || v === 'triaged' || v === 'queued' || v === 'planned')
        return 'planned';
    if (v === 'parked' || v === 'deferred')
        return 'parked';
    return null;
}
function emptyCount() {
    return {
        shipped: 0,
        beta: 0,
        alpha: 0,
        planned: 0,
        parked: 0,
        total: 0,
        total_active: 0,
        pct_shipped: 0,
        pct_beta: 0,
        pct_alpha: 0,
        pct_planned: 0,
    };
}
function finalize(count) {
    count.total = count.shipped + count.beta + count.alpha + count.planned + count.parked;
    count.total_active = count.shipped + count.beta + count.alpha + count.planned;
    if (count.total_active > 0) {
        count.pct_shipped = (count.shipped / count.total_active) * 100;
        count.pct_beta = (count.beta / count.total_active) * 100;
        count.pct_alpha = (count.alpha / count.total_active) * 100;
        count.pct_planned = (count.planned / count.total_active) * 100;
    }
    return count;
}
function emptyAggregate() {
    return { all: emptyCount(), bySource: {} };
}
function addToAggregate(agg, row, bucket) {
    agg.all[bucket] += 1;
    const src = row.Repository || '__unknown__';
    if (!agg.bySource[src])
        agg.bySource[src] = emptyCount();
    agg.bySource[src][bucket] += 1;
}
function finalizeAggregate(agg) {
    finalize(agg.all);
    for (const key of Object.keys(agg.bySource))
        finalize(agg.bySource[key]);
    return agg;
}
function warn(msg) {
    console.warn(`[progress] ${msg}`);
}
export function computeProgress(tables) {
    const delivery = emptyAggregate();
    const backlog = emptyAggregate();
    const byTableMut = {};
    const bucketFor = (tableKey) => {
        if (!byTableMut[tableKey])
            byTableMut[tableKey] = emptyAggregate();
        return byTableMut[tableKey];
    };
    // Mobile and Web feature tables roll up via their subfeature rows
    // (Delivery axis) — per-row surface-state columns are gone under v3.
    for (const row of tables.subfeatures?.rows || []) {
        const bucket = classifySubfeatureStatus(row.Status || '');
        if (!bucket) {
            warn(`subfeatures.Status unknown value ${JSON.stringify(row.Status)}`);
            continue;
        }
        addToAggregate(bucketFor('subfeatures'), row, bucket);
        addToAggregate(delivery, row, bucket);
    }
    for (const row of tables.backlog?.rows || []) {
        const bucket = classifyBacklogStatus(row.Status || '');
        if (!bucket) {
            warn(`backlog.Status unknown value ${JSON.stringify(row.Status)}`);
            continue;
        }
        addToAggregate(bucketFor('backlog'), row, bucket);
        addToAggregate(backlog, row, bucket);
    }
    const byTable = {};
    for (const key of Object.keys(byTableMut))
        byTable[key] = finalizeAggregate(byTableMut[key]);
    return {
        delivery: finalizeAggregate(delivery),
        backlog: finalizeAggregate(backlog),
        byTable,
    };
}
