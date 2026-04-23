import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const DEFAULT_PATHS = {
    mirror: 'docs/specs-mirror',
    generated: 'docs/generated',
    output: 'docs_public',
};
export function loadConfig(flags) {
    const cwd = typeof flags.cwd === 'string' ? resolve(flags.cwd) : process.cwd();
    const configPath = typeof flags.config === 'string'
        ? resolve(cwd, flags.config)
        : resolve(cwd, 'blueprint.config.json');
    if (!existsSync(configPath)) {
        throw new Error(`Blueprint config not found: ${configPath}\n\nCreate a blueprint.config.json in your repo root, or pass --config <path>.\nSee docs/getting-started.md for the shape.`);
    }
    const raw = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!raw.sources || raw.sources.length === 0) {
        throw new Error(`Blueprint config has no sources: ${configPath}`);
    }
    const config = {
        sources: raw.sources,
        paths: { ...DEFAULT_PATHS, ...(raw.paths || {}) },
    };
    return { config, cwd, configPath };
}
