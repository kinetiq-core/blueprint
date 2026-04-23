import { readFileSync } from 'fs'
import { marked } from 'marked'
import { dirname, isAbsolute, normalize, posix, resolve as resolvePath, sep } from 'path'

export type SpecFrontmatter = Record<string, string>

export type SpecMeta = {
  sourceId: string
  sourceSlug: string
  sourceLabel: string
  sourceRoot: string
  specPath: string
  relPath: string
  fullPath: string
  url: string
  title: string
  frontmatter: SpecFrontmatter
  hasSubfeatures: boolean
  hasBacklog: boolean
}

export type SourceHandle = {
  id: string
  label: string
  slug: string
  resolvedRoot: string
  originRoot: string
}

export function sourceIdToSlug(id: string): string {
  return id.replace(/^kinetiq-/, '')
}

export function specUrlFor(sourceSlug: string, relPath: string): string {
  const posixPath = relPath.replace(/\\/g, '/')
  return `${sourceSlug}/${posixPath.replace(/\.md$/, '.html')}`
}

function parseFrontmatter(markdown: string): { data: SpecFrontmatter; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { data: {}, body: markdown }
  const data: SpecFrontmatter = {}
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx === -1) continue
    data[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  return { data, body: markdown.slice(match[0].length) }
}

function extractTitle(body: string, frontmatter: SpecFrontmatter, fallback: string): string {
  if (frontmatter.title) return frontmatter.title
  const h1 = body.match(/^#\s+(.+)$/m)
  return h1 ? h1[1].trim() : fallback
}

export function loadSpec(source: SourceHandle, file: { fullPath: string; relPath: string; specPath: string }): SpecMeta {
  const markdown = readFileSync(file.fullPath, 'utf8')
  const { data, body } = parseFrontmatter(markdown)
  const normalizedRel = file.relPath.replace(/\\/g, '/')
  const fallback = normalizedRel.split('/').pop()?.replace(/\.md$/, '') || normalizedRel
  return {
    sourceId: source.id,
    sourceSlug: source.slug,
    sourceLabel: source.label,
    sourceRoot: source.resolvedRoot,
    specPath: file.specPath,
    relPath: normalizedRel,
    fullPath: file.fullPath,
    url: specUrlFor(source.slug, normalizedRel),
    title: extractTitle(body, data, fallback),
    frontmatter: data,
    hasSubfeatures: /^###\s+(Mobile |Web )?Subfeatures\s*$/m.test(body),
    hasBacklog: /^###\s+Backlog\s*$/m.test(body),
  }
}

function normaliseFsPath(p: string): string {
  return normalize(p).replace(/\\/g, '/').replace(/\/+$/, '')
}

export type SpecIndex = {
  byAbsolutePath: Map<string, SpecMeta>
  sources: SourceHandle[]
}

export function buildSpecIndex(specs: SpecMeta[], sources: SourceHandle[]): SpecIndex {
  const byAbsolutePath = new Map<string, SpecMeta>()
  for (const spec of specs) {
    byAbsolutePath.set(normaliseFsPath(spec.fullPath), spec)
  }
  return { byAbsolutePath, sources }
}

type Slugger = { slug(text: string): string }
function createSlugger(): Slugger {
  const seen = new Map<string, number>()
  return {
    slug(text: string) {
      const base = text
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
      const count = seen.get(base) || 0
      seen.set(base, count + 1)
      return count === 0 ? base || 'section' : `${base}-${count}`
    },
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;')
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

function encodeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isExternalUrl(href: string): boolean {
  return /^(https?:|mailto:|tel:|ftp:)/i.test(href)
}

type ResolveResult =
  | { kind: 'external' }
  | { kind: 'fragment'; fragment: string }
  | { kind: 'spec'; spec: SpecMeta; fragment: string; href: string }
  | { kind: 'unknown-file'; cleanedText: string }

function splitFragment(href: string): { path: string; fragment: string } {
  const hashIdx = href.indexOf('#')
  if (hashIdx === -1) return { path: href, fragment: '' }
  return { path: href.slice(0, hashIdx), fragment: href.slice(hashIdx) }
}

function cleanAbsoluteForDisplay(absPath: string, sources: SourceHandle[]): string {
  const norm = normaliseFsPath(absPath)
  for (const source of sources) {
    for (const root of [source.originRoot, source.resolvedRoot]) {
      if (!root) continue
      const rootNorm = normaliseFsPath(root)
      if (norm === rootNorm || norm.startsWith(rootNorm + '/')) {
        const tail = norm.slice(rootNorm.length).replace(/^\/+/, '')
        return tail ? `${source.id}/${tail}` : source.id
      }
    }
  }
  const projectRoot = norm.match(/^(?:[a-z]:\/|\/)?.*\/kinetiq-core\//i)
  if (projectRoot) {
    return norm.slice(projectRoot[0].length)
  }
  return norm
}

function translateOriginToMirror(absPath: string, sources: SourceHandle[]): string {
  const norm = normaliseFsPath(absPath)
  for (const source of sources) {
    if (!source.originRoot) continue
    const origin = normaliseFsPath(source.originRoot)
    if (norm === origin || norm.startsWith(origin + '/')) {
      const mirror = normaliseFsPath(source.resolvedRoot)
      const tail = norm.slice(origin.length)
      return mirror + tail
    }
  }
  return norm
}

function tryResolveAbsoluteToSpec(absPath: string, index: SpecIndex): SpecMeta | null {
  const norm = normaliseFsPath(absPath)
  const direct = index.byAbsolutePath.get(norm)
  if (direct) return direct
  const translated = translateOriginToMirror(absPath, index.sources)
  if (translated !== norm) {
    return index.byAbsolutePath.get(translated) || null
  }
  return null
}

function resolveHref(href: string, currentSpec: SpecMeta, index: SpecIndex): ResolveResult {
  if (!href) return { kind: 'unknown-file', cleanedText: '' }
  if (isExternalUrl(href)) return { kind: 'external' }
  if (href.startsWith('#')) return { kind: 'fragment', fragment: href }

  const { path: rawPath, fragment } = splitFragment(href)
  const decoded = decodeURIComponent(rawPath)

  let absoluteCandidate: string | null = null
  if (/^[a-z]:[\\/]/i.test(decoded) || decoded.startsWith('/') || decoded.startsWith('\\')) {
    absoluteCandidate = resolvePath(decoded)
  } else {
    const currentDir = dirname(currentSpec.fullPath)
    absoluteCandidate = resolvePath(currentDir, decoded)
  }

  const target = tryResolveAbsoluteToSpec(absoluteCandidate, index)
  if (target) {
    return { kind: 'spec', spec: target, fragment, href: target.url }
  }

  const cleaned = cleanAbsoluteForDisplay(absoluteCandidate, index.sources)
  return { kind: 'unknown-file', cleanedText: cleaned }
}

function rewriteLinks(html: string, currentSpec: SpecMeta, index: SpecIndex, warnings: string[]): string {
  return html.replace(/<a\s+href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (_match, href: string, attrs: string, innerHtml: string) => {
    const result = resolveHref(href, currentSpec, index)
    if (result.kind === 'external') {
      return `<a href="${escAttr(href)}"${attrs} rel="noopener noreferrer" target="_blank">${innerHtml}</a>`
    }
    if (result.kind === 'fragment') {
      return `<a href="${escAttr(result.fragment)}"${attrs}>${innerHtml}</a>`
    }
    if (result.kind === 'spec') {
      return `<a href="${escAttr(result.href)}${result.fragment}"${attrs}>${innerHtml}</a>`
    }
    warnings.push(`unresolved link in ${currentSpec.specPath}: ${href}`)
    return innerHtml
  })
}

function normaliseCodeSpans(html: string, currentSpec: SpecMeta, index: SpecIndex): string {
  return html.replace(/<code>([^<]+)<\/code>/g, (match, inner: string) => {
    const raw = decodeEntities(inner)
    if (!/kinetiq-core|kinetiq-engine|kinetiq-library|kinetiq-business/i.test(raw)) return match
    const trimmed = raw.trim()
    const isAbsoluteWindows = /^[a-z]:[\\/]/i.test(trimmed)
    const isAbsoluteUnix = trimmed.startsWith('/') && trimmed.includes('kinetiq-core/')
    if (!isAbsoluteWindows && !isAbsoluteUnix) return match

    const cleaned = cleanAbsoluteForDisplay(trimmed, index.sources)
    const endsWithMd = /\.md\/?$/.test(cleaned)
    if (endsWithMd) {
      const resolvedAbs = resolvePath(trimmed)
      const spec = tryResolveAbsoluteToSpec(resolvedAbs, index)
      if (spec) {
        return `<a href="${escAttr(spec.url)}"><code>${encodeText(cleaned)}</code></a>`
      }
    }
    return `<code>${encodeText(cleaned)}</code>`
  })
}

function injectHeadingSlugs(html: string, slugger: Slugger, headings: Array<{ level: number; text: string; slug: string }>): string {
  return html.replace(/<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g, (_match, levelStr: string, attrs: string | undefined, inner: string) => {
    const level = Number(levelStr)
    const text = stripTags(inner).trim()
    const slug = slugger.slug(text)
    headings.push({ level, text, slug })
    const existing = attrs ?? ''
    return `<h${level}${existing} id="${escAttr(slug)}">${inner}</h${level}>`
  })
}

export type RenderedSpec = {
  html: string
  title: string
  headings: Array<{ level: number; text: string; slug: string }>
  warnings: string[]
}

export function renderSpec(spec: SpecMeta, index: SpecIndex): RenderedSpec {
  const markdown = readFileSync(spec.fullPath, 'utf8')
  const { body: rawBody } = parseFrontmatter(markdown)

  // Hard-break consecutive metadata lines (`**Label:** value`) so they
  // don't collapse into one wrapped paragraph. Without this, authors
  // must remember to put two trailing spaces on every metadata line.
  const body = rawBody.replace(/^(\*\*[^\n:*]+:\*\*[^\n]*)$/gm, '$1  ')

  marked.setOptions({ gfm: true, breaks: false })
  let html = marked.parse(body) as string

  const slugger = createSlugger()
  const headings: Array<{ level: number; text: string; slug: string }> = []
  html = injectHeadingSlugs(html, slugger, headings)

  const warnings: string[] = []
  html = rewriteLinks(html, spec, index, warnings)
  html = normaliseCodeSpans(html, spec, index)

  html = html.replace(/<table>/g, '<div class="content-table-scroll"><table>')
  html = html.replace(/<\/table>/g, '</table></div>')

  return {
    html,
    title: spec.title,
    headings,
    warnings,
  }
}

export function isAbsolutePath(p: string): boolean {
  return isAbsolute(p) || /^[a-z]:[\\/]/i.test(p)
}

export const PATH_SEP = sep
