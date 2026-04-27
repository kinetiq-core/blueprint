import { existsSync, readdirSync } from 'fs';
import { basename, join } from 'path';
function walkMarkdown(dir, base) {
    const results = [];
    if (!existsSync(dir))
        return results;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        const relPath = base ? join(base, entry.name) : entry.name;
        if (entry.isDirectory()) {
            results.push(...walkMarkdown(fullPath, relPath));
        }
        else if (entry.name.endsWith('.md')) {
            results.push({ fullPath, relPath });
        }
    }
    return results;
}
export function collectSpecFiles(sourceId, rootPath) {
    const files = [];
    const specsDir = join(rootPath, 'docs', 'specs');
    const developersDir = join(rootPath, 'docs', 'developers');
    for (const file of walkMarkdown(specsDir, 'specs')) {
        if (!isSpecMarkdown(basename(file.fullPath)))
            continue;
        files.push({
            ...file,
            specPath: `${sourceId}/docs/${file.relPath.replace(/\\/g, '/')}`,
        });
    }
    for (const file of walkMarkdown(developersDir, 'developers')) {
        if (!isSpecMarkdown(basename(file.fullPath)))
            continue;
        files.push({
            ...file,
            specPath: `${sourceId}/docs/${file.relPath.replace(/\\/g, '/')}`,
        });
    }
    return files;
}
function isSpecMarkdown(name) {
    return name.startsWith('spec_');
}
