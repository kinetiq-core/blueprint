import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { loadConfig } from '../config.js'
import { collectSpecFiles } from '../lib/spec-files.js'
import { collectSpecTracking, type TrackingRow } from '../lib/spec-tracking.js'
import { computeProgress, type ProgressSnapshot } from '../lib/progress.js'

type SnapshotTable = {
  title: string
  headers: string[]
  rows: TrackingRow[]
  csvFile: string
}

type SnapshotSource = {
  id: string
  label: string
  configuredRoot: string
  originRoot: string
  resolvedRoot: string
  status: 'ok' | 'missing'
  trackedFiles: number
}

type Snapshot = {
  generatedAt: string
  generatedBy: string
  sources: SnapshotSource[]
  tables: Record<string, SnapshotTable>
  progress: ProgressSnapshot
}

function toRepoRel(cwd: string, abs: string): string {
  return relative(cwd, abs).replace(/\\/g, '/')
}

function toCsv(headers: string[], rows: TrackingRow[]): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [
    headers.map(esc).join(','),
    ...rows.map((row) => headers.map((h) => esc(row[h] || '')).join(',')),
  ].join('\n')
}

function withSource(rows: TrackingRow[], source: { id: string; label: string }): TrackingRow[] {
  return rows.map((row) => ({
    Source: source.label,
    Repository: source.id,
    ...row,
  }))
}

export async function aggregate(flags: Record<string, string | boolean>): Promise<void> {
  const { config, cwd } = loadConfig(flags)
  const mirrorDir = resolve(cwd, config.paths.mirror)
  const outputDir = resolve(cwd, config.paths.generated)
  mkdirSync(outputDir, { recursive: true })

  const mobileFeatureRows: TrackingRow[] = []
  const webFeatureRows: TrackingRow[] = []
  const backendRows: TrackingRow[] = []
  const releaseRows: TrackingRow[] = []
  const opsRows: TrackingRow[] = []
  const futureRows: TrackingRow[] = []
  const subfeatureRows: TrackingRow[] = []
  const backlogRows: TrackingRow[] = []
  const snapshotSources: SnapshotSource[] = []

  for (const source of config.sources) {
    const originRoot = resolve(cwd, source.root)
    const mirrorRoot = resolve(mirrorDir, source.id)

    if (!existsSync(mirrorRoot)) {
      snapshotSources.push({
        id: source.id,
        label: source.label,
        configuredRoot: source.root,
        originRoot: toRepoRel(cwd, originRoot),
        resolvedRoot: toRepoRel(cwd, mirrorRoot),
        status: 'missing',
        trackedFiles: 0,
      })
      console.warn(`[aggregate] Missing mirror for ${source.label}. Run \`blueprint collect\` first.`)
      continue
    }

    const files = collectSpecFiles(source.id, mirrorRoot)
    const tracking = collectSpecTracking(files)

    mobileFeatureRows.push(...withSource(tracking.mobileFeatureRows, source))
    webFeatureRows.push(...withSource(tracking.webFeatureRows, source))
    backendRows.push(...withSource(tracking.backendRows, source))
    releaseRows.push(...withSource(tracking.releaseRows, source))
    opsRows.push(...withSource(tracking.opsRows, source))
    futureRows.push(...withSource(tracking.futureRows, source))
    subfeatureRows.push(...withSource(tracking.subfeatureRows, source))
    backlogRows.push(...withSource(tracking.backlogRows, source))

    snapshotSources.push({
      id: source.id,
      label: source.label,
      configuredRoot: source.root,
      originRoot: toRepoRel(cwd, originRoot),
      resolvedRoot: toRepoRel(cwd, mirrorRoot),
      status: 'ok',
      trackedFiles: files.length,
    })

    console.warn(`[aggregate] Collected ${files.length} spec files from ${source.label}`)
  }

  const tables: Record<string, SnapshotTable> = {
    mobile_features: {
      title: 'Mobile Features',
      headers: ['Source', 'Repository', 'Spec', 'Feature Group', 'Feature', 'Phase'],
      rows: mobileFeatureRows,
      csvFile: 'mobile_features.csv',
    },
    web_features: {
      title: 'Web Features',
      headers: ['Source', 'Repository', 'Spec', 'Feature Group', 'Feature', 'Phase'],
      rows: webFeatureRows,
      csvFile: 'web_features.csv',
    },
    backend: {
      title: 'Backend',
      headers: ['Source', 'Repository', 'Spec', 'Backend Group', 'Capability', 'Phase'],
      rows: backendRows,
      csvFile: 'backend.csv',
    },
    release: {
      title: 'Release',
      headers: ['Source', 'Repository', 'Spec', 'Area', 'Feature Group', 'Feature', 'Phase'],
      rows: releaseRows,
      csvFile: 'release.csv',
    },
    ops: {
      title: 'Ops',
      headers: ['Source', 'Repository', 'Spec', 'Area', 'Feature Group', 'Feature', 'Phase'],
      rows: opsRows,
      csvFile: 'ops.csv',
    },
    features_future: {
      title: 'Future Features',
      headers: ['Source', 'Repository', 'Spec', 'Feature Group', 'Feature', 'Horizon', 'Notes'],
      rows: futureRows,
      csvFile: 'features_future.csv',
    },
    subfeatures: {
      title: 'Tracked Subfeatures',
      headers: ['Source', 'Repository', 'Spec', 'Key', 'Subfeature', 'Surface', 'Status', 'Target', 'Delivered', 'Notes'],
      rows: subfeatureRows,
      csvFile: 'subfeatures.csv',
    },
    backlog: {
      title: 'Backlog',
      headers: ['Source', 'Repository', 'Spec', 'Key', 'Type', 'Item', 'Status', 'Notes'],
      rows: backlogRows,
      csvFile: 'backlog.csv',
    },
  }

  for (const table of Object.values(tables)) {
    writeFileSync(join(outputDir, table.csvFile), toCsv(table.headers, table.rows))
  }

  const progress = computeProgress(tables)
  const snapshot: Snapshot = {
    generatedAt: new Date().toISOString(),
    generatedBy: '@kinetiq-core/blueprint aggregate',
    sources: snapshotSources,
    tables,
    progress,
  }

  const snapshotPath = join(outputDir, 'roadmaps.json')
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  console.warn(`[aggregate] Wrote ${toRepoRel(cwd, snapshotPath)}`)
}
