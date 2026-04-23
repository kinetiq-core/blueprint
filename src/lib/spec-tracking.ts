import { readFileSync } from 'fs'

export interface TrackingFile {
  fullPath: string
  relPath: string
  specPath: string
}

export interface TrackingRow {
  [key: string]: string
}

export interface TrackingResult {
  mobileFeatureRows: TrackingRow[]
  webFeatureRows: TrackingRow[]
  backendRows: TrackingRow[]
  releaseRows: TrackingRow[]
  opsRows: TrackingRow[]
  futureRows: TrackingRow[]
  subfeatureRows: TrackingRow[]
  backlogRows: TrackingRow[]
  mobileFeatureCsv: string
  webFeatureCsv: string
  backendCsv: string
  releaseCsv: string
  opsCsv: string
  futureCsv: string
  subfeatureCsv: string
  backlogCsv: string
}

function parseFrontmatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {} as Record<string, string>, body: markdown }

  const raw = match[1].split(/\r?\n/)
  const data: Record<string, string> = {}

  for (const line of raw) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    data[key] = value
  }

  return {
    data,
    body: markdown.slice(match[0].length),
  }
}

function extractSection(markdown: string, heading: string) {
  const lines = markdown.split('\n')
  const sectionHeader = heading.toLowerCase()
  let start = -1

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() === sectionHeader) {
      start = i + 1
      break
    }
  }

  if (start === -1) return [] as string[]

  const collected: string[] = []
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (/^##\s+/i.test(trimmed) || /^###\s+/i.test(trimmed)) break
    collected.push(line)
  }
  return collected
}

function parseMarkdownTable(lines: string[]) {
  const trimmed = lines.map((line) => line.trim()).filter(Boolean)
  const tableLines = trimmed.filter((line) => line.startsWith('|') && line.endsWith('|'))
  if (tableLines.length < 2) return [] as TrackingRow[]

  const splitRow = (row: string) =>
    row
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim())

  const headers = splitRow(tableLines[0])
  const rows: TrackingRow[] = []

  for (let i = 2; i < tableLines.length; i++) {
    const cells = splitRow(tableLines[i])
    if (cells.length !== headers.length) continue
    const row: TrackingRow = {}
    headers.forEach((header, idx) => {
      row[header] = cells[idx]
    })
    rows.push(row)
  }

  return rows
}

function csvEscape(value: string) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function toCsv(headers: string[], rows: TrackingRow[]) {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] || '')).join(',')),
  ].join('\n')
}

export function collectSpecTracking(specFiles: TrackingFile[]): TrackingResult {
  const mobileFeatureRows: TrackingRow[] = []
  const webFeatureRows: TrackingRow[] = []
  const backendRows: TrackingRow[] = []
  const releaseRows: TrackingRow[] = []
  const opsRows: TrackingRow[] = []
  const futureRows: TrackingRow[] = []
  const subfeatureRows: TrackingRow[] = []
  const backlogRows: TrackingRow[] = []

  for (const file of specFiles) {
    const markdown = readFileSync(file.fullPath, 'utf8')
    const { data, body } = parseFrontmatter(markdown)
    const specRef = file.specPath || file.relPath.replace(/\\/g, '/')

    const hasMobileFeatureMeta = data.roadmap_mobile_feature_item || data.roadmap_mobile_feature_group
    const hasWebFeatureMeta = data.roadmap_web_feature_item || data.roadmap_web_feature_group
    const hasBackendMeta = data.roadmap_backend_item || data.roadmap_type === 'backend'
    const hasReleaseMeta = data.roadmap_release_item
    const hasOpsMeta = data.roadmap_ops_item
    const hasFutureMeta = data.roadmap_future_item

    if (hasMobileFeatureMeta) {
      mobileFeatureRows.push({
        Spec: specRef,
        'Feature Group': data.roadmap_mobile_feature_group || '',
        Feature: data.roadmap_mobile_feature_item || '',
        Phase: data.roadmap_mobile_feature_phase || '',
      })
    }

    if (hasWebFeatureMeta) {
      webFeatureRows.push({
        Spec: specRef,
        'Feature Group': data.roadmap_web_feature_group || '',
        Feature: data.roadmap_web_feature_item || '',
        Phase: data.roadmap_web_feature_phase || '',
      })
    }

    if (hasBackendMeta) {
      backendRows.push({
        Spec: specRef,
        'Backend Group': data.roadmap_backend_group || data.roadmap_group || '',
        Capability: data.roadmap_backend_item || data.roadmap_item || '',
        Phase: data.roadmap_backend_phase || data.roadmap_phase || '',
      })
    }

    if (hasReleaseMeta) {
      releaseRows.push({
        Spec: specRef,
        Area: data.roadmap_release_area || '',
        'Feature Group': data.roadmap_release_group || '',
        Feature: data.roadmap_release_item || '',
        Phase: data.roadmap_release_phase || '',
      })
    }

    if (hasOpsMeta) {
      opsRows.push({
        Spec: specRef,
        Area: data.roadmap_ops_area || '',
        'Feature Group': data.roadmap_ops_group || '',
        Feature: data.roadmap_ops_item || '',
        Phase: data.roadmap_ops_phase || '',
      })
    }

    if (hasFutureMeta) {
      futureRows.push({
        Spec: specRef,
        'Feature Group': data.roadmap_future_group || '',
        Feature: data.roadmap_future_item || '',
        Horizon: data.roadmap_future_horizon || '',
        Notes: data.roadmap_future_notes || '',
      })
    }

    // v3: feature specs use `### Mobile Subfeatures` + `### Web Subfeatures`.
    // Other specs (backend, library, …) keep a single `### Subfeatures` block.
    const mobileSubs = parseMarkdownTable(extractSection(body, '### Mobile Subfeatures'))
    for (const row of mobileSubs) {
      subfeatureRows.push({
        Spec: specRef,
        Key: row.Key || '',
        Subfeature: row.Subfeature || '',
        Surface: 'Mobile',
        Status: row.Status || '',
        Target: row.Target || '',
        Delivered: row.Delivered || '',
        Notes: row.Notes || '',
      })
    }
    const webSubs = parseMarkdownTable(extractSection(body, '### Web Subfeatures'))
    for (const row of webSubs) {
      subfeatureRows.push({
        Spec: specRef,
        Key: row.Key || '',
        Subfeature: row.Subfeature || '',
        Surface: 'Web',
        Status: row.Status || '',
        Target: row.Target || '',
        Delivered: row.Delivered || '',
        Notes: row.Notes || '',
      })
    }
    const legacySubs = parseMarkdownTable(extractSection(body, '### Subfeatures'))
    for (const row of legacySubs) {
      subfeatureRows.push({
        Spec: specRef,
        Key: row.Key || '',
        Subfeature: row.Subfeature || '',
        Surface: row.Surface || '',
        Status: row.Status || '',
        Target: row.Target || '',
        Delivered: row.Delivered || '',
        Notes: row.Notes || '',
      })
    }

    const backlog = parseMarkdownTable(extractSection(body, '### Backlog'))
    for (const row of backlog) {
      backlogRows.push({
        Spec: specRef,
        Key: row.Key || '',
        Type: row.Type || '',
        Item: row.Item || '',
        Status: row.Status || '',
        Notes: row.Notes || '',
      })
    }
  }

  mobileFeatureRows.sort((a, b) => a.Feature.localeCompare(b.Feature))
  webFeatureRows.sort((a, b) => a.Feature.localeCompare(b.Feature))
  backendRows.sort((a, b) => a.Capability.localeCompare(b.Capability))
  releaseRows.sort((a, b) => a.Feature.localeCompare(b.Feature))
  opsRows.sort((a, b) => a.Feature.localeCompare(b.Feature))
  futureRows.sort((a, b) => a.Feature.localeCompare(b.Feature))
  subfeatureRows.sort((a, b) => a.Key.localeCompare(b.Key))
  backlogRows.sort((a, b) => a.Key.localeCompare(b.Key))

  return {
    mobileFeatureRows,
    webFeatureRows,
    backendRows,
    releaseRows,
    opsRows,
    futureRows,
    subfeatureRows,
    backlogRows,
    mobileFeatureCsv: toCsv(['Spec', 'Feature Group', 'Feature', 'Phase'], mobileFeatureRows),
    webFeatureCsv: toCsv(['Spec', 'Feature Group', 'Feature', 'Phase'], webFeatureRows),
    backendCsv: toCsv(['Spec', 'Backend Group', 'Capability', 'Phase'], backendRows),
    releaseCsv: toCsv(['Spec', 'Area', 'Feature Group', 'Feature', 'Phase'], releaseRows),
    opsCsv: toCsv(['Spec', 'Area', 'Feature Group', 'Feature', 'Phase'], opsRows),
    futureCsv: toCsv(['Spec', 'Feature Group', 'Feature', 'Horizon', 'Notes'], futureRows),
    subfeatureCsv: toCsv(['Spec', 'Key', 'Subfeature', 'Surface', 'Status', 'Target', 'Delivered', 'Notes'], subfeatureRows),
    backlogCsv: toCsv(['Spec', 'Key', 'Type', 'Item', 'Status', 'Notes'], backlogRows),
  }
}
