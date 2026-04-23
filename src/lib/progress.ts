export type ProgressBucket = 'shipped' | 'beta' | 'alpha' | 'planned' | 'parked'

export type ProgressCount = {
  shipped: number
  beta: number
  alpha: number
  planned: number
  parked: number
  total: number
  total_active: number
  pct_shipped: number
  pct_beta: number
  pct_alpha: number
  pct_planned: number
}

export type ProgressAggregate = {
  all: ProgressCount
  bySource: Record<string, ProgressCount>
}

export type ProgressSnapshot = {
  capability: ProgressAggregate
  delivery: ProgressAggregate
  backlog: ProgressAggregate
  byTable: Record<string, ProgressAggregate>
}

type Row = Record<string, string>

function stripDate(value: string) {
  return value.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function phaseParked(row: Row) {
  return String(row.Phase || '').trim().toLowerCase() === 'parked'
}

function classifyMaturity(value: string): ProgressBucket | null {
  const v = stripDate(value).toLowerCase()
  if (!v || v === '-') return null
  if (v === 'ready') return 'shipped'
  if (v === 'beta') return 'beta'
  if (v === 'alpha' || v === 'started') return 'alpha'
  if (v === 'planned' || v === 'draft' || v === 'placeholder') return 'planned'
  if (v === 'parked') return 'parked'
  return null
}

function classifySubfeatureStatus(value: string): ProgressBucket | null {
  const v = stripDate(value).toLowerCase()
  if (!v) return null
  if (v === 'done' || v === 'implemented') return 'shipped'
  if (v === 'alpha' || v === 'started' || v === 'in progress') return 'alpha'
  if (v === 'planned' || v === 'open') return 'planned'
  if (v === 'deferred' || v === 'parked') return 'parked'
  return null
}

function classifyBacklogStatus(value: string): ProgressBucket | null {
  const v = stripDate(value).toLowerCase()
  if (!v) return null
  if (v === 'done' || v === 'resolved' || v === 'closed') return 'shipped'
  if (v === 'started' || v === 'in progress' || v === 'drafted') return 'alpha'
  if (v === 'open' || v === 'triaged' || v === 'planned') return 'planned'
  if (v === 'parked' || v === 'deferred') return 'parked'
  return null
}

function emptyCount(): ProgressCount {
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
  }
}

function finalize(count: ProgressCount): ProgressCount {
  count.total = count.shipped + count.beta + count.alpha + count.planned + count.parked
  count.total_active = count.shipped + count.beta + count.alpha + count.planned
  if (count.total_active > 0) {
    count.pct_shipped = (count.shipped / count.total_active) * 100
    count.pct_beta = (count.beta / count.total_active) * 100
    count.pct_alpha = (count.alpha / count.total_active) * 100
    count.pct_planned = (count.planned / count.total_active) * 100
  }
  return count
}

type MutableAggregate = { all: ProgressCount; bySource: Record<string, ProgressCount> }

function emptyAggregate(): MutableAggregate {
  return { all: emptyCount(), bySource: {} }
}

function addToAggregate(agg: MutableAggregate, row: Row, bucket: ProgressBucket) {
  agg.all[bucket] += 1
  const src = row.Repository || '__unknown__'
  if (!agg.bySource[src]) agg.bySource[src] = emptyCount()
  agg.bySource[src][bucket] += 1
}

function finalizeAggregate(agg: MutableAggregate): ProgressAggregate {
  finalize(agg.all)
  for (const key of Object.keys(agg.bySource)) finalize(agg.bySource[key])
  return agg
}

function warn(msg: string) {
  console.warn(`[progress] ${msg}`)
}

export function computeProgress(tables: Record<string, { headers: string[]; rows: Row[] }>): ProgressSnapshot {
  const capability = emptyAggregate()
  const delivery = emptyAggregate()
  const backlog = emptyAggregate()
  const byTableMut: Record<string, MutableAggregate> = {}

  const bucketFor = (tableKey: string) => {
    if (!byTableMut[tableKey]) byTableMut[tableKey] = emptyAggregate()
    return byTableMut[tableKey]
  }

  for (const row of tables.features?.rows || []) {
    const parked = phaseParked(row)
    for (const surface of ['Mobile', 'Web'] as const) {
      const raw = String(row[surface] || '')
      if (!raw || raw === '-') continue
      const bucket = parked ? 'parked' : classifyMaturity(raw)
      if (!bucket) {
        warn(`features.${surface} unknown value ${JSON.stringify(raw)}`)
        continue
      }
      addToAggregate(bucketFor('features'), row, bucket)
      addToAggregate(capability, row, bucket)
    }
  }

  for (const key of ['backend', 'release', 'ops'] as const) {
    for (const row of tables[key]?.rows || []) {
      const parked = phaseParked(row)
      const bucket = parked ? 'parked' : classifyMaturity(row.Maturity || '')
      if (!bucket) {
        warn(`${key}.Maturity unknown value ${JSON.stringify(row.Maturity)}`)
        continue
      }
      addToAggregate(bucketFor(key), row, bucket)
      addToAggregate(capability, row, bucket)
    }
  }

  for (const row of tables.subfeatures?.rows || []) {
    const bucket = classifySubfeatureStatus(row.Status || '')
    if (!bucket) {
      warn(`subfeatures.Status unknown value ${JSON.stringify(row.Status)}`)
      continue
    }
    addToAggregate(bucketFor('subfeatures'), row, bucket)
    addToAggregate(delivery, row, bucket)
  }

  for (const row of tables.backlog?.rows || []) {
    const bucket = classifyBacklogStatus(row.Status || '')
    if (!bucket) {
      warn(`backlog.Status unknown value ${JSON.stringify(row.Status)}`)
      continue
    }
    addToAggregate(bucketFor('backlog'), row, bucket)
    addToAggregate(backlog, row, bucket)
  }

  const byTable: Record<string, ProgressAggregate> = {}
  for (const key of Object.keys(byTableMut)) byTable[key] = finalizeAggregate(byTableMut[key])

  return {
    capability: finalizeAggregate(capability),
    delivery: finalizeAggregate(delivery),
    backlog: finalizeAggregate(backlog),
    byTable,
  }
}
