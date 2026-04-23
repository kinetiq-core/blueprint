import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '../config.js';
export async function collect(flags) {
    const { config, cwd } = loadConfig(flags);
    const mirrorDir = resolve(cwd, config.paths.mirror);
    mkdirSync(mirrorDir, { recursive: true });
    let total = 0;
    for (const source of config.sources) {
        const originRoot = resolve(cwd, source.root);
        const mirrorRoot = resolve(mirrorDir, source.id);
        if (!existsSync(originRoot)) {
            console.warn(`[collect] ${source.label}: origin not found at ${source.root} — skipping (existing mirror left untouched)`);
            continue;
        }
        rmSync(mirrorRoot, { recursive: true, force: true });
        const specsCount = copyFiltered(join(originRoot, 'docs', 'specs'), join(mirrorRoot, 'docs', 'specs'), () => true);
        const devCount = copyFiltered(join(originRoot, 'docs', 'developers'), join(mirrorRoot, 'docs', 'developers'), (n) => n.startsWith('spec_'));
        const count = specsCount + devCount;
        total += count;
        console.warn(`[collect] ${source.label}: synced ${count} files (${specsCount} specs, ${devCount} developers)`);
    }
    console.warn(`[collect] Done. ${total} total spec files mirrored under ${config.paths.mirror}`);
}
function copyFiltered(srcDir, destDir, filter) {
    if (!existsSync(srcDir))
        return 0;
    let count = 0;
    for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = join(srcDir, entry.name);
        const destPath = join(destDir, entry.name);
        if (entry.isDirectory()) {
            count += copyFiltered(srcPath, destPath, filter);
        }
        else if (entry.name.endsWith('.md') && filter(entry.name)) {
            mkdirSync(dirname(destPath), { recursive: true });
            cpSync(srcPath, destPath);
            count += 1;
        }
    }
    return count;
}
