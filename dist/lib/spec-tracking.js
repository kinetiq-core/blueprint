import { readFileSync } from 'fs';
function parseFrontmatter(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match)
        return { data: {}, body: markdown };
    const raw = match[1].split(/\r?\n/);
    const data = {};
    for (const line of raw) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const idx = trimmed.indexOf(':');
        if (idx === -1)
            continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        data[key] = value;
    }
    return {
        data,
        body: markdown.slice(match[0].length),
    };
}
function extractSection(markdown, heading) {
    const lines = markdown.split('\n');
    const sectionHeader = heading.toLowerCase();
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().toLowerCase() === sectionHeader) {
            start = i + 1;
            break;
        }
    }
    if (start === -1)
        return [];
    const collected = [];
    for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (/^##\s+/i.test(trimmed) || /^###\s+/i.test(trimmed))
            break;
        collected.push(line);
    }
    return collected;
}
function parseMarkdownTable(lines) {
    const trimmed = lines.map((line) => line.trim()).filter(Boolean);
    const tableLines = trimmed.filter((line) => line.startsWith('|') && line.endsWith('|'));
    if (tableLines.length < 2)
        return [];
    const splitRow = (row) => row
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
    const headers = splitRow(tableLines[0]);
    const rows = [];
    for (let i = 2; i < tableLines.length; i++) {
        const cells = splitRow(tableLines[i]);
        if (cells.length !== headers.length)
            continue;
        const row = {};
        headers.forEach((header, idx) => {
            row[header] = cells[idx];
        });
        rows.push(row);
    }
    return rows;
}
function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}
function toCsv(headers, rows) {
    return [
        headers.map(csvEscape).join(','),
        ...rows.map((row) => headers.map((header) => csvEscape(row[header] || '')).join(',')),
    ].join('\n');
}
export function collectSpecTracking(specFiles) {
    const featureRows = [];
    const backendRows = [];
    const releaseRows = [];
    const opsRows = [];
    const futureRows = [];
    const subfeatureRows = [];
    const backlogRows = [];
    for (const file of specFiles) {
        const markdown = readFileSync(file.fullPath, 'utf8');
        const { data, body } = parseFrontmatter(markdown);
        const specRef = file.specPath || file.relPath.replace(/\\/g, '/');
        const hasFeatureMeta = data.roadmap_feature_item || data.roadmap_type === 'feature';
        const hasBackendMeta = data.roadmap_backend_item || data.roadmap_type === 'backend';
        const hasReleaseMeta = data.roadmap_release_item;
        const hasOpsMeta = data.roadmap_ops_item;
        const hasFutureMeta = data.roadmap_future_item;
        if (hasFeatureMeta) {
            featureRows.push({
                Spec: specRef,
                'Feature Group': data.roadmap_feature_group || data.roadmap_group || '',
                Feature: data.roadmap_feature_item || data.roadmap_item || '',
                Phase: data.roadmap_feature_phase || data.roadmap_phase || '',
                Mobile: data.roadmap_mobile || '',
                Web: data.roadmap_web || '',
            });
        }
        if (hasBackendMeta) {
            backendRows.push({
                Spec: specRef,
                'Backend Group': data.roadmap_backend_group || data.roadmap_group || '',
                Capability: data.roadmap_backend_item || data.roadmap_item || '',
                Phase: data.roadmap_backend_phase || data.roadmap_phase || '',
            });
        }
        if (hasReleaseMeta) {
            releaseRows.push({
                Spec: specRef,
                Area: data.roadmap_release_area || '',
                'Feature Group': data.roadmap_release_group || '',
                Feature: data.roadmap_release_item || '',
                Phase: data.roadmap_release_phase || '',
            });
        }
        if (hasOpsMeta) {
            opsRows.push({
                Spec: specRef,
                Area: data.roadmap_ops_area || '',
                'Feature Group': data.roadmap_ops_group || '',
                Feature: data.roadmap_ops_item || '',
                Phase: data.roadmap_ops_phase || '',
            });
        }
        if (hasFutureMeta) {
            futureRows.push({
                Spec: specRef,
                'Feature Group': data.roadmap_future_group || '',
                Feature: data.roadmap_future_item || '',
                Horizon: data.roadmap_future_horizon || '',
                Notes: data.roadmap_future_notes || '',
            });
        }
        const subfeatures = parseMarkdownTable(extractSection(body, '### Subfeatures'));
        for (const row of subfeatures) {
            subfeatureRows.push({
                Spec: specRef,
                Key: row.Key || '',
                Subfeature: row.Subfeature || '',
                Surface: row.Surface || '',
                Status: row.Status || '',
                Notes: row.Notes || '',
            });
        }
        const backlog = parseMarkdownTable(extractSection(body, '### Backlog'));
        for (const row of backlog) {
            backlogRows.push({
                Spec: specRef,
                Key: row.Key || '',
                Type: row.Type || '',
                Item: row.Item || '',
                Status: row.Status || '',
                Notes: row.Notes || '',
            });
        }
    }
    featureRows.sort((a, b) => a.Feature.localeCompare(b.Feature));
    backendRows.sort((a, b) => a.Capability.localeCompare(b.Capability));
    releaseRows.sort((a, b) => a.Feature.localeCompare(b.Feature));
    opsRows.sort((a, b) => a.Feature.localeCompare(b.Feature));
    futureRows.sort((a, b) => a.Feature.localeCompare(b.Feature));
    subfeatureRows.sort((a, b) => a.Key.localeCompare(b.Key));
    backlogRows.sort((a, b) => a.Key.localeCompare(b.Key));
    return {
        featureRows,
        backendRows,
        releaseRows,
        opsRows,
        futureRows,
        subfeatureRows,
        backlogRows,
        featureCsv: toCsv(['Spec', 'Feature Group', 'Feature', 'Phase', 'Mobile', 'Web'], featureRows),
        backendCsv: toCsv(['Spec', 'Backend Group', 'Capability', 'Phase'], backendRows),
        releaseCsv: toCsv(['Spec', 'Area', 'Feature Group', 'Feature', 'Phase'], releaseRows),
        opsCsv: toCsv(['Spec', 'Area', 'Feature Group', 'Feature', 'Phase'], opsRows),
        futureCsv: toCsv(['Spec', 'Feature Group', 'Feature', 'Horizon', 'Notes'], futureRows),
        subfeatureCsv: toCsv(['Spec', 'Key', 'Subfeature', 'Surface', 'Status', 'Notes'], subfeatureRows),
        backlogCsv: toCsv(['Spec', 'Key', 'Type', 'Item', 'Status', 'Notes'], backlogRows),
    };
}
