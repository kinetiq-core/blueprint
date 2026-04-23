import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { collectSpecFiles } from '../lib/spec-files.js';
import { collectSpecTracking } from '../lib/spec-tracking.js';
import { computeProgress } from '../lib/progress.js';
function toRepoRel(cwd, abs) {
    return relative(cwd, abs).replace(/\\/g, '/');
}
function toCsv(headers, rows) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
        headers.map(esc).join(','),
        ...rows.map((row) => headers.map((h) => esc(row[h] || '')).join(',')),
    ].join('\n');
}
function withSource(rows, source) {
    return rows.map((row) => ({
        Source: source.label,
        Repository: source.id,
        ...row,
    }));
}
export async function aggregate(flags) {
    const { config, cwd } = loadConfig(flags);
    const mirrorDir = resolve(cwd, config.paths.mirror);
    const outputDir = resolve(cwd, config.paths.generated);
    mkdirSync(outputDir, { recursive: true });
    const featureRows = [];
    const backendRows = [];
    const releaseRows = [];
    const opsRows = [];
    const futureRows = [];
    const subfeatureRows = [];
    const backlogRows = [];
    const snapshotSources = [];
    for (const source of config.sources) {
        const originRoot = resolve(cwd, source.root);
        const mirrorRoot = resolve(mirrorDir, source.id);
        if (!existsSync(mirrorRoot)) {
            snapshotSources.push({
                id: source.id,
                label: source.label,
                configuredRoot: source.root,
                originRoot: toRepoRel(cwd, originRoot),
                resolvedRoot: toRepoRel(cwd, mirrorRoot),
                status: 'missing',
                trackedFiles: 0,
            });
            console.warn(`[aggregate] Missing mirror for ${source.label}. Run \`blueprint collect\` first.`);
            continue;
        }
        const files = collectSpecFiles(source.id, mirrorRoot);
        const tracking = collectSpecTracking(files);
        featureRows.push(...withSource(tracking.featureRows, source));
        backendRows.push(...withSource(tracking.backendRows, source));
        releaseRows.push(...withSource(tracking.releaseRows, source));
        opsRows.push(...withSource(tracking.opsRows, source));
        futureRows.push(...withSource(tracking.futureRows, source));
        subfeatureRows.push(...withSource(tracking.subfeatureRows, source));
        backlogRows.push(...withSource(tracking.backlogRows, source));
        snapshotSources.push({
            id: source.id,
            label: source.label,
            configuredRoot: source.root,
            originRoot: toRepoRel(cwd, originRoot),
            resolvedRoot: toRepoRel(cwd, mirrorRoot),
            status: 'ok',
            trackedFiles: files.length,
        });
        console.warn(`[aggregate] Collected ${files.length} spec files from ${source.label}`);
    }
    const tables = {
        features: {
            title: 'Features',
            headers: ['Source', 'Repository', 'Spec', 'Feature Group', 'Feature', 'Phase', 'Mobile', 'Web'],
            rows: featureRows,
            csvFile: 'features.csv',
        },
        backend: {
            title: 'Backend',
            headers: ['Source', 'Repository', 'Spec', 'Backend Group', 'Capability', 'Phase', 'Maturity'],
            rows: backendRows,
            csvFile: 'backend.csv',
        },
        release: {
            title: 'Release',
            headers: ['Source', 'Repository', 'Spec', 'Area', 'Feature Group', 'Feature', 'Phase', 'Maturity'],
            rows: releaseRows,
            csvFile: 'release.csv',
        },
        ops: {
            title: 'Ops',
            headers: ['Source', 'Repository', 'Spec', 'Area', 'Feature Group', 'Feature', 'Phase', 'Maturity'],
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
            headers: ['Source', 'Repository', 'Spec', 'Key', 'Subfeature', 'Surface', 'Status', 'Notes'],
            rows: subfeatureRows,
            csvFile: 'subfeatures.csv',
        },
        backlog: {
            title: 'Backlog',
            headers: ['Source', 'Repository', 'Spec', 'Key', 'Type', 'Item', 'Status', 'Notes'],
            rows: backlogRows,
            csvFile: 'backlog.csv',
        },
    };
    for (const table of Object.values(tables)) {
        writeFileSync(join(outputDir, table.csvFile), toCsv(table.headers, table.rows));
    }
    const progress = computeProgress(tables);
    const snapshot = {
        generatedAt: new Date().toISOString(),
        generatedBy: '@kinetiq-core/blueprint aggregate',
        sources: snapshotSources,
        tables,
        progress,
    };
    const snapshotPath = join(outputDir, 'roadmaps.json');
    writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    console.warn(`[aggregate] Wrote ${toRepoRel(cwd, snapshotPath)}`);
}
