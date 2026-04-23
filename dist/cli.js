#!/usr/bin/env node
import { collect } from './commands/collect.js';
import { aggregate } from './commands/aggregate.js';
import { generate } from './commands/generate.js';
import { refresh } from './commands/refresh.js';
const VERSION = '0.0.1';
const USAGE = `
Blueprint — living-specs toolchain for spec-driven development.

Usage:
  blueprint <command> [options]

Commands:
  collect      Mirror spec files from configured sources into specs-mirror/
  aggregate    Walk the mirror, emit tracking snapshots (JSON + CSV)
  generate     Build the rendered HTML site
  refresh      Run collect + aggregate + generate in sequence
  help         Show this message
  version      Show version

Options:
  --config <path>    Path to blueprint.config.json (default: ./blueprint.config.json)
  --cwd <path>       Working directory (default: process.cwd())

See https://github.com/kinetiq-core/blueprint for docs.
`.trim();
function parseArgs(argv) {
    const [, , command = 'help', ...rest] = argv;
    const flags = {};
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = rest[i + 1];
            if (next && !next.startsWith('--')) {
                flags[key] = next;
                i++;
            }
            else {
                flags[key] = true;
            }
        }
    }
    return { command, flags };
}
async function main() {
    const { command, flags } = parseArgs(process.argv);
    switch (command) {
        case 'collect':
            await collect(flags);
            break;
        case 'aggregate':
            await aggregate(flags);
            break;
        case 'generate':
            await generate(flags);
            break;
        case 'refresh':
            await refresh(flags);
            break;
        case 'version':
        case '--version':
        case '-v':
            console.log(VERSION);
            break;
        case 'help':
        case '--help':
        case '-h':
        default:
            console.log(USAGE);
            break;
    }
}
main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
