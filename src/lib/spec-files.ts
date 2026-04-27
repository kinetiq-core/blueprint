import { existsSync, readdirSync } from 'fs'
import { basename, join } from 'path'

export type SpecFile = {
  fullPath: string
  relPath: string
  specPath: string
}

function walkMarkdown(dir: string, base: string): Array<{ fullPath: string; relPath: string }> {
  const results: Array<{ fullPath: string; relPath: string }> = []
  if (!existsSync(dir)) return results

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    const relPath = base ? join(base, entry.name) : entry.name
    if (entry.isDirectory()) {
      results.push(...walkMarkdown(fullPath, relPath))
    } else if (entry.name.endsWith('.md')) {
      results.push({ fullPath, relPath })
    }
  }

  return results
}

export function collectSpecFiles(sourceId: string, rootPath: string): SpecFile[] {
  const files: SpecFile[] = []
  const specsDir = join(rootPath, 'docs', 'specs')
  const developersDir = join(rootPath, 'docs', 'developers')

  for (const file of walkMarkdown(specsDir, 'specs')) {
    if (!isSpecMarkdown(basename(file.fullPath))) continue
    files.push({
      ...file,
      specPath: `${sourceId}/docs/${file.relPath.replace(/\\/g, '/')}`,
    })
  }

  for (const file of walkMarkdown(developersDir, 'developers')) {
    if (!isSpecMarkdown(basename(file.fullPath))) continue
    files.push({
      ...file,
      specPath: `${sourceId}/docs/${file.relPath.replace(/\\/g, '/')}`,
    })
  }

  return files
}

function isSpecMarkdown(name: string): boolean {
  return name.startsWith('spec_')
}
