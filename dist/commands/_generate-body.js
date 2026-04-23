import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { collectSpecFiles } from '../lib/spec-files.js';
import { buildSpecIndex, loadSpec, renderSpec, sourceIdToSlug, } from '../lib/spec-render.js';
import { loadConfig } from '../config.js';
export async function generate(flags) {
    const { config, cwd: ROOT } = loadConfig(flags);
    const SNAPSHOT_PATH = resolve(ROOT, config.paths.generated, 'roadmaps.json');
    const OUTPUT_DIR = resolve(ROOT, config.paths.output);
    function ensureDir(dir) {
        mkdirSync(dir, { recursive: true });
    }
    function escHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    function statusTone(value) {
        const v = String(value || '').toLowerCase();
        if (v === 'ready' || v === 'closed')
            return 'ready';
        if (v === 'alpha' || v === 'beta' || v === 'started' || v === 'in progress' || v === 'now')
            return 'active';
        if (v === 'planned' || v === 'poc' || v === 'triaged' || v === 'exploratory' || v === 'later')
            return 'planned';
        if (v === 'parked' || v === 'blocked' || v === 'deprecated' || v === 'missing')
            return 'parked';
        if (v === 'open')
            return 'open';
        if (v === '-')
            return 'na';
        return '';
    }
    function isStatusLikeColumn(header) {
        const lc = header.toLowerCase();
        return (lc === 'phase' ||
            lc === 'mobile' ||
            lc === 'web' ||
            lc === 'maturity' ||
            lc === 'status' ||
            lc === 'surface' ||
            lc === 'type' ||
            lc === 'horizon');
    }
    function renderCell(header, value) {
        const raw = String(value || '');
        if (!raw)
            return '';
        if (isStatusLikeColumn(header)) {
            const tone = statusTone(raw);
            return `<span class="status-badge${tone ? ` status-${tone}` : ''}">${escHtml(raw)}</span>`;
        }
        return escHtml(raw);
    }
    function columnClass(header) {
        const lc = header.toLowerCase();
        if (lc === 'source')
            return 'col-source';
        if (lc === 'spec')
            return 'col-spec';
        if (lc === 'feature')
            return 'col-feature';
        if (lc === 'capability')
            return 'col-capability';
        if (lc === 'subfeature')
            return 'col-subfeature';
        if (lc === 'item')
            return 'col-item';
        if (lc === 'notes')
            return 'col-notes';
        return '';
    }
    const TABLE_ORDER = [];
    function getProgressCount(snapshot, scope, sourceId) {
        const agg = scope === 'delivery' || scope === 'backlog'
            ? snapshot.progress[scope]
            : snapshot.progress.byTable[scope];
        if (!agg)
            return null;
        const count = sourceId ? agg.bySource[sourceId] : agg.all;
        return count || null;
    }
    const TABLE_SCOPE = {
        mobile_features: 'mobile_features',
        web_features: 'web_features',
        backend: 'backend',
        release: 'release',
        ops: 'ops',
    };
    const TABLE_GROUPING = {
        mobile_features: { groupColumn: 'Feature Group', leafColumns: ['Feature'] },
        web_features: { groupColumn: 'Feature Group', leafColumns: ['Feature'] },
        backend: { groupColumn: 'Backend Group', leafColumns: ['Capability'] },
        release: { groupColumn: 'Area', leafColumns: ['Feature Group', 'Feature'] },
        ops: { groupColumn: 'Area', leafColumns: ['Feature Group', 'Feature'] },
        features_future: { groupColumn: 'Feature Group', leafColumns: ['Feature'] },
    };
    function naturalCompare(a, b) {
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    }
    function sortByGrouping(rows, grouping) {
        return [...rows].sort((a, b) => {
            const ga = a[grouping.groupColumn] || '';
            const gb = b[grouping.groupColumn] || '';
            const groupCmp = naturalCompare(ga, gb);
            if (groupCmp !== 0)
                return groupCmp;
            for (const col of grouping.leafColumns) {
                const av = a[col] || '';
                const bv = b[col] || '';
                const cmp = naturalCompare(av, bv);
                if (cmp !== 0)
                    return cmp;
            }
            return 0;
        });
    }
    function renderBreadcrumbs(crumbs) {
        if (!crumbs.length)
            return '';
        const sep = '<span class="crumb-sep" aria-hidden="true">/</span>';
        const parts = crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            if (c.href && !isLast) {
                return `<a class="crumb" href="${escHtml(c.href)}">${escHtml(c.label)}</a>`;
            }
            return `<span class="crumb${isLast ? ' crumb-current' : ''}">${escHtml(c.label)}</span>`;
        });
        return `<nav class="breadcrumbs" aria-label="Breadcrumb">${parts.join(sep)}</nav>`;
    }
    const PROGRESS_LEGEND_HTML = `
  <div class="progress-legend" aria-label="Progress bar key">
    <span class="progress-legend-item"><span class="progress-legend-swatch shipped"></span>Shipped</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch beta"></span>Beta</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch alpha"></span>Alpha &middot; in progress</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch planned"></span>Planned</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch parked"></span>Parked (excluded from %)</span>
  </div>`;
    function renderProgress(count, opts = {}) {
        if (!count || count.total === 0)
            return '';
        const segments = [
            count.shipped > 0 ? `<span class="progress-seg shipped" style="width:${count.pct_shipped}%" title="${count.shipped} shipped"></span>` : '',
            count.beta > 0 ? `<span class="progress-seg beta" style="width:${count.pct_beta}%" title="${count.beta} beta"></span>` : '',
            count.alpha > 0 ? `<span class="progress-seg alpha" style="width:${count.pct_alpha}%" title="${count.alpha} alpha"></span>` : '',
            count.planned > 0 ? `<span class="progress-seg planned" style="width:${count.pct_planned}%" title="${count.planned} planned"></span>` : '',
        ]
            .filter(Boolean)
            .join('');
        const barInner = segments || '<span class="progress-seg empty" style="width:100%"></span>';
        const pct = count.total_active > 0 ? Math.round(count.pct_shipped) : 0;
        const meta = [];
        meta.push(`<span class="progress-pct">${pct}%</span>`);
        meta.push(`<span class="progress-count"><b>${count.shipped}</b> shipped</span>`);
        if (count.beta)
            meta.push(`<span class="progress-count"><b>${count.beta}</b> beta</span>`);
        if (count.alpha)
            meta.push(`<span class="progress-count"><b>${count.alpha}</b> alpha</span>`);
        if (count.planned)
            meta.push(`<span class="progress-count"><b>${count.planned}</b> planned</span>`);
        if (count.parked)
            meta.push(`<span class="progress-parked">${count.parked} parked</span>`);
        return `
    <div class="progress${opts.compact ? ' progress-compact' : ''}">
      <div class="progress-bar">${barInner}</div>
      <div class="progress-meta">${meta.join('')}</div>
    </div>`;
    }
    const LEGAL_NOTICE_HTML = `
<footer class="legal-footer" aria-label="Legal notice">
  <div class="legal-footer-title">Copyright &copy; Kinetiq Core Ltd. All rights reserved.</div>
  <p class="legal-footer-copy">
    Confidential and proprietary material of Kinetiq Core Ltd. For internal use only. Not for publication,
    redistribution, external circulation, or commercial reuse, in whole or in part, without prior written
    permission from Kinetiq Core Ltd. No licence or other rights are granted except as expressly authorised.
  </p>
</footer>`;
    // In single-source mode the source-slug directory is dropped from URLs —
    // the mount path alone is already distinctive. Set after sections build.
    let SINGLE_SOURCE_MODE = false;
    function sectionPrefix(sectionSlug) {
        if (sectionSlug === 'root' || SINGLE_SOURCE_MODE)
            return '';
        return `${sectionSlug}/`;
    }
    function routeFor(sectionSlug, pageKey) {
        if (pageKey === 'search')
            return 'search.html';
        if (pageKey === 'browse')
            return `${sectionPrefix(sectionSlug)}browse/index.html`;
        if (sectionSlug === 'root' && pageKey === 'index')
            return 'index.html';
        return `${sectionPrefix(sectionSlug)}${pageKey}.html`;
    }
    function csvRouteFor(sectionSlug, tableKey) {
        return `${sectionSlug}/${tableKey}.csv`;
    }
    function sourceSlug(sourceId) {
        return sourceId.replace(/^kinetiq-/, '');
    }
    function sourceNavLabel(label) {
        return label.replace(/^Kinetiq\s+/i, '');
    }
    function toCsv(headers, rows) {
        const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        return [
            headers.map(escapeCell).join(','),
            ...rows.map((row) => headers.map((header) => escapeCell(row[header] || '')).join(',')),
        ].join('\n');
    }
    function buildSections(snapshot) {
        const okSources = snapshot.sources.filter((source) => source.status === 'ok');
        // In single-source mode the root Index already is the section overview,
        // so the per-source Overview page would just duplicate it.
        const skipOverview = okSources.length <= 1;
        const sourceSections = okSources.map((source) => {
            const slug = sourceSlug(source.id);
            const pages = skipOverview
                ? []
                : [{ key: 'index', label: 'Overview', href: routeFor(slug, 'index') }];
            for (const key of TABLE_ORDER) {
                const table = snapshot.tables[key];
                if (!table)
                    continue;
                const rows = table.rows.filter((row) => row.Repository === source.id);
                if (!rows.length)
                    continue;
                pages.push({ key, label: table.title, href: routeFor(slug, key) });
            }
            return {
                slug,
                label: sourceNavLabel(source.label),
                source,
                pages,
            };
        });
        // Portfolio is the combined-sources view. When there's only one source it
        // duplicates that source's section, so skip it.
        if (okSources.length <= 1)
            return sourceSections;
        const portfolio = {
            slug: 'portfolio',
            label: 'Portfolio',
            pages: [{ key: 'index', label: 'Overview', href: routeFor('portfolio', 'index') }],
        };
        for (const key of TABLE_ORDER) {
            const table = snapshot.tables[key];
            if (table?.rows.length) {
                portfolio.pages.push({ key, label: table.title, href: routeFor('portfolio', key) });
            }
        }
        return [portfolio, ...sourceSections];
    }
    function sectionRows(section, table) {
        if (!section.source)
            return table.rows;
        return table.rows.filter((row) => row.Repository === section.source?.id);
    }
    const SEARCH_SCRIPT = `
<script src="https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.min.js" defer></script>
<script>
document.addEventListener('DOMContentLoaded', function() {
  var searchData, fuse;

  function searchFor(q) {
    if (!searchData) return [];
    var qLower = q.toLowerCase();
    var exact = searchData.filter(function(d) {
      return (d.title && d.title.toLowerCase().indexOf(qLower) !== -1)
        || (d.section && d.section.toLowerCase().indexOf(qLower) !== -1)
        || (d.group && d.group.toLowerCase().indexOf(qLower) !== -1)
        || (d.snippet && d.snippet.toLowerCase().indexOf(qLower) !== -1);
    }).map(function(d) { return { item: d }; });
    if (exact.length > 0) return exact;
    if (!fuse) return [];
    return fuse.search(q);
  }

  fetch('data/search-index.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      searchData = data;
      fuse = new Fuse(data, {
        keys: [{ name: 'title', weight: 3 }, { name: 'section', weight: 1 }, { name: 'group', weight: 1 }, { name: 'snippet', weight: 2 }],
        threshold: 0.3,
        ignoreLocation: true
      });
      document.querySelectorAll('.search-input').forEach(function(input) {
        var dropdown = input.parentElement.querySelector('.search-results');
        var timer;
        var activeIdx = -1;

        function updateHighlight() {
          var items = dropdown.querySelectorAll('.search-result-item');
          items.forEach(function(el, i) {
            el.classList.toggle('highlighted', i === activeIdx);
            if (i === activeIdx) el.scrollIntoView({ block: 'nearest' });
          });
        }

        input.addEventListener('input', function() {
          activeIdx = -1;
          clearTimeout(timer);
          timer = setTimeout(function() {
            var q = input.value.trim();
            if (!q) { dropdown.classList.remove('active'); dropdown.innerHTML = ''; return; }
            var results = searchFor(q).slice(0, 10);
            dropdown.innerHTML = results.map(function(r) {
              var it = r.item;
              return '<a class="search-result-item" href="' + it.url + '">'
                + '<span class="search-result-name">' + it.title + '</span>'
                + '<span class="search-result-section">' + it.section + (it.group ? ' / ' + it.group : '') + '</span>'
                + '</a>';
            }).join('');
            dropdown.classList.toggle('active', results.length > 0);
          }, 150);
        });

        input.addEventListener('keydown', function(e) {
          var items = dropdown.querySelectorAll('.search-result-item');
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
            updateHighlight();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, -1);
            updateHighlight();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0 && items[activeIdx]) {
              items[activeIdx].click();
            } else if (input.value.trim()) {
              window.location.href = 'search.html?q=' + encodeURIComponent(input.value.trim());
            }
          } else if (e.key === 'Escape') {
            input.value = '';
            dropdown.classList.remove('active');
            activeIdx = -1;
          }
        });
      });

      document.addEventListener('click', function(e) {
        document.querySelectorAll('.search-results.active').forEach(function(d) {
          if (!d.parentElement.contains(e.target)) d.classList.remove('active');
        });
      });
    })
    .catch(function(e) { console.warn('Search index not loaded:', e); });
});
</script>`;
    function buildTopbar(sections, activeSectionSlug) {
        const links = [
            `<a href="index.html" class="${activeSectionSlug === 'root' ? 'active' : ''}">Overview</a>`,
            ...sections.map((section) => `<a href="${section.pages[0]?.href}" class="${section.slug === activeSectionSlug ? 'active' : ''}">${escHtml(section.label)}</a>`),
        ].join('');
        return `
  <div class="topbar" id="topbar">
    <div class="topbar-brand">
      <button class="topbar-menu-btn" aria-label="Menu" onclick="document.querySelector('.sidebar').classList.toggle('open')">&#9776;</button>
      <a href="../index.html" class="topbar-wordmark">KINETIQ CORE</a>
    </div>
    <nav class="topbar-nav">${links}</nav>
    <div class="topbar-search search-bar">
      <input type="text" class="search-input" placeholder="Search…" />
      <span class="search-kbd">⌘K</span>
      <div class="search-results"></div>
    </div>
  </div>`;
    }
    function buildSidebar(sections, activeSectionSlug, activePageKey) {
        return `
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="../index.html" class="sidebar-back">Resources</a>
      <div class="sidebar-title">Roadmaps</div>
    </div>
    <div class="sidebar-nav">
      <div class="nav-section">
        <div class="nav-section-title">Overview</div>
        <a href="index.html" class="sidebar-link ${activeSectionSlug === 'root' && activePageKey === 'index' ? 'active' : ''}">Contents</a>
        <a href="search.html" class="sidebar-link ${activeSectionSlug === 'root' && activePageKey === 'search' ? 'active' : ''}">Search</a>
      </div>
      ${sections
            .map((section) => `
      <div class="nav-section">
        <div class="nav-section-title">${escHtml(section.label)}</div>
        ${section.pages
            .map((page) => `<a href="${page.href}" class="sidebar-link ${section.slug === activeSectionSlug && page.key === activePageKey ? 'active' : ''}">${escHtml(page.label)}</a>`)
            .join('')}
      </div>`)
            .join('')}
    </div>
  </aside>`;
    }
    function pageShell(title, sections, activeSectionSlug, activePageKey, body, pagePath) {
        const depth = pagePath.split('/').filter(Boolean).length - 1;
        const baseHref = depth > 0 ? '../'.repeat(depth) : './';
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<base href="${baseHref}">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  :root {
    --bg: #f6f7f4;
    --surface: #ffffff;
    --paper: #ffffff;
    --ink: #152028;
    --muted: #5E6A72;
    --accent: #C96F3B;
    --secondary: #2F7C7A;
    --border: #D7E0E3;
    --line: #D7E0E3;
    --sidebar-bg: #F7F9FA;
    --sidebar-text: #5E6A72;
    --sidebar-active: #182126;
    --topbar-height: 52px;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: linear-gradient(180deg, #eef3f2 0%, var(--bg) 32%, #f8f8f5 100%);
    color: var(--ink);
    line-height: 1.7;
    display: flex;
    min-height: 100vh;
    padding-top: var(--topbar-height);
  }

  .topbar {
    position: fixed; top: 0; left: 0; right: 0;
    min-height: 52px;
    background: #F7F9FA; z-index: 25;
    display: flex; align-items: stretch; flex-wrap: wrap;
    border-bottom: 1px solid #D7E0E3;
  }
  .topbar-breadcrumb { display: none; }
  .topbar-brand {
    width: 260px; flex-shrink: 0;
    display: flex; align-items: center; gap: 10px;
    padding: 0 20px 0 24px;
    border-right: 1px solid #D7E0E3;
  }
  .topbar-menu-btn {
    display: none; background: none; border: none; color: #182126;
    font-size: 17px; cursor: pointer; padding: 4px 6px; line-height: 1;
    border-radius: 6px; flex-shrink: 0;
  }
  .topbar-menu-btn:hover { background: rgba(24,33,38,0.06); }
  .topbar-wordmark {
    font-size: 13px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; color: #182126; text-decoration: none; white-space: nowrap;
  }
  .topbar-nav {
    flex: 1; display: flex; align-items: center; padding: 0 12px; gap: 2px;
  }
  .topbar-nav a {
    padding: 5px 11px; font-size: 13px; font-weight: 600;
    color: #5E6A72; text-decoration: none;
    border-radius: 6px; transition: all 0.1s; white-space: nowrap;
  }
  .topbar-nav a:hover { color: #182126; background: rgba(24,33,38,0.05); }
  .topbar-nav a.active { color: #182126; }
  .topbar-search {
    position: relative; display: flex; align-items: center;
    padding: 0 20px 0 12px; gap: 8px;
    border-left: 1px solid #D7E0E3;
  }
  .topbar-search .search-input {
    width: 340px; padding: 8px 14px;
    border: 1px solid #D7E0E3; border-radius: 8px;
    font-size: 13.5px; font-family: inherit; background: white;
    color: #182126; outline: none; box-sizing: border-box;
  }
  .topbar-search .search-input::placeholder { color: #8A9BA3; }
  .topbar-search .search-input:focus { border-color: #C96F3B; box-shadow: 0 0 0 3px rgba(201,111,59,0.1); }
  .search-kbd {
    font-size: 11px; font-weight: 600; color: #8A9BA3;
    background: #F0F4F5; border: 1px solid #D7E0E3;
    border-radius: 4px; padding: 2px 6px; white-space: nowrap;
    pointer-events: none; flex-shrink: 0;
  }
  .topbar-search .search-results {
    position: absolute; top: calc(100% + 4px); right: 20px; left: 12px; z-index: 100;
    background: white; border: 1px solid #D7E0E3;
    border-radius: 8px; max-height: 360px; overflow-y: auto;
    box-shadow: 0 12px 32px rgba(24,33,38,0.12); display: none;
  }
  .topbar-search .search-results.active { display: block; }
  .topbar-search .search-result-item {
    display: block; padding: 11px 12px; text-decoration: none;
    border-bottom: 1px solid #E8EEF0; color: #182126;
  }
  .topbar-search .search-result-item:last-child { border-bottom: 0; }
  .topbar-search .search-result-item.highlighted,
  .topbar-search .search-result-item:hover { background: #F7F9FA; }
  .search-result-name {
    display: block; color: #182126; font-size: 13px; font-weight: 700;
  }
  .search-result-section {
    display: block; margin-top: 3px; color: #5E6A72; font-size: 11px;
  }
  .layout {
    display: block;
    width: 100%;
    min-height: calc(100vh - var(--topbar-height));
  }
  .sidebar {
    width: 260px;
    background: var(--sidebar-bg);
    border-right: 1px solid #D7E0E3;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sidebar-header {
    flex-shrink: 0;
    padding: calc(var(--topbar-height) + 16px) 24px 20px;
    border-bottom: 1px solid #D7E0E3;
    background: var(--sidebar-bg);
  }
  .nav-section { margin-bottom: 8px; }
  .nav-section-title {
    padding: 12px 24px 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #2F7C7A;
  }
  .sidebar-back {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sidebar-text);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 12px;
    transition: color 0.1s;
  }
  .sidebar-back::before {
    content: '\\2190'; font-size: 12px;
  }
  .sidebar-back:hover { color: var(--sidebar-active); }
  .sidebar-title {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--sidebar-active);
    line-height: 1.15;
  }
  .sidebar-nav {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
  .sidebar-link {
    display: block;
    padding: 7px 24px 7px 32px;
    font-size: 14px;
    font-weight: 500;
    color: var(--sidebar-text);
    text-decoration: none;
    line-height: 1.35;
    transition: all 0.1s;
    border-left: 3px solid transparent;
  }
  .sidebar-link:hover {
    color: var(--sidebar-active);
    background: rgba(24,33,38,0.04);
  }
  .sidebar-link.active {
    color: var(--sidebar-active);
    font-weight: 600;
    background: rgba(24,33,38,0.06);
    border-left-color: #C96F3B;
  }
  .main {
    width: calc(100% - 260px);
    margin-left: 260px;
    padding: calc(var(--topbar-height) + 32px) 0 64px;
  }
  .shell {
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 32px;
  }
  .hero, .panel {
    background: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(215, 224, 227, 0.95);
    border-radius: 24px;
    box-shadow: 0 18px 60px rgba(21, 32, 40, 0.06);
  }
  .hero { padding: 56px 40px 36px; }
  .panel { padding: 28px 28px 24px; margin-top: 20px; }
  .eyebrow {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h1 {
    margin-top: 16px;
    font-size: clamp(40px, 6vw, 64px);
    line-height: 0.98;
    letter-spacing: -0.04em;
  }
  .subhead {
    margin-top: 18px;
    max-width: 900px;
    font-size: 18px;
    color: var(--muted);
  }
  .meta {
    margin-top: 20px;
    font-size: 13px;
    color: var(--muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
    margin-top: 28px;
  }
  .card {
    display: block;
    text-decoration: none;
    color: inherit;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 22px 20px;
  }
  .card:hover { border-color: var(--secondary); }
  .card h2 {
    font-size: 15px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .card p {
    margin-top: 10px;
    color: var(--muted);
    font-size: 14px;
  }
  .card .jump {
    margin-top: 14px;
    color: var(--secondary);
    font-size: 14px;
    font-weight: 600;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(47, 124, 122, 0.1);
    color: var(--secondary);
    font-size: 12px;
    font-weight: 700;
  }
  .source-list {
    display: grid;
    gap: 12px;
    margin-top: 18px;
  }
  .source-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 14px 16px;
    background: #fff;
  }
  .source-meta {
    color: var(--muted);
    font-size: 13px;
  }
  .table-wrap {
    overflow-x: auto;
    margin-top: 16px;
  }
  table {
    width: 100%;
    min-width: 1100px;
    border-collapse: collapse;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 18px;
    overflow: hidden;
  }
  th, td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
    font-size: 13px;
  }
  th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    background: #f8faf9;
  }
  th.col-source, td.col-source,
  th.col-repository, td.col-repository {
    white-space: nowrap;
    width: 120px;
  }
  th.col-spec, td.col-spec {
    width: 260px;
    min-width: 240px;
    max-width: 260px;
    font-size: 12px;
    color: var(--muted);
    word-break: normal;
    overflow-wrap: anywhere;
  }
  th.col-feature, td.col-feature,
  th.col-capability, td.col-capability,
  th.col-subfeature, td.col-subfeature,
  th.col-item, td.col-item {
    min-width: 320px;
  }
  th.col-notes, td.col-notes {
    min-width: 280px;
  }
  tr:last-child td { border-bottom: 0; }
  tr.group-header td {
    background: rgba(47, 124, 122, 0.06);
    padding: 8px 14px 8px 18px;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    border-left: 3px solid var(--secondary);
    font-size: 13px;
    white-space: normal;
  }
  tr.group-header + tr td { border-top: 0; }
  .group-header-label {
    display: inline-block;
    color: var(--muted);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 10px;
    margin-right: 10px;
    vertical-align: middle;
  }
  .group-header-value {
    color: var(--ink);
    font-weight: 700;
    font-size: 13px;
    text-decoration: none;
    vertical-align: middle;
  }
  a.group-header-value:hover { color: var(--secondary); }
  .group-header-path {
    display: inline-block;
    margin-left: 10px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    color: var(--muted);
    vertical-align: middle;
  }
  .status-badge {
    display: inline-flex;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    background: rgba(93, 105, 112, 0.12);
    color: var(--muted);
    white-space: nowrap;
  }
  .status-ready { background: rgba(47, 124, 122, 0.12); color: var(--secondary); }
  .status-active { background: rgba(201, 111, 59, 0.12); color: var(--accent); }
  .status-planned { background: rgba(21, 32, 40, 0.08); color: var(--ink); }
  .status-parked { background: rgba(93, 105, 112, 0.12); color: var(--muted); }
  .status-open { background: rgba(201, 111, 59, 0.1); color: var(--accent); }
  .progress {
    margin-top: 18px;
  }
  .progress-compact {
    margin-top: 12px;
  }
  .progress-bar {
    display: flex;
    height: 10px;
    border-radius: 999px;
    background: #E6ECEE;
    overflow: hidden;
  }
  .progress-compact .progress-bar {
    height: 6px;
  }
  .progress-seg { display: block; height: 100%; }
  .progress-seg.shipped { background: var(--secondary); }
  .progress-seg.beta { background: #6FA9A1; }
  .progress-seg.alpha { background: var(--accent); }
  .progress-seg.planned { background: #BFC9CD; }
  .progress-seg.empty { background: transparent; }
  .progress-meta {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: center;
    font-size: 13px;
    color: var(--muted);
  }
  .progress-compact .progress-meta {
    margin-top: 8px;
    font-size: 12px;
    gap: 4px 10px;
  }
  .progress-pct {
    font-size: 14px;
    font-weight: 800;
    color: var(--ink);
    letter-spacing: -0.01em;
  }
  .progress-compact .progress-pct { font-size: 13px; }
  .progress-count b { color: var(--ink); font-weight: 700; }
  .progress-parked {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: 999px;
    background: rgba(93, 105, 112, 0.14);
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
  .progress-legend {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    margin-top: 18px;
    padding: 8px 14px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.72);
    font-size: 12px;
    color: var(--muted);
  }
  .progress-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .progress-legend-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .progress-legend-swatch.shipped { background: var(--secondary); }
  .progress-legend-swatch.beta { background: #6FA9A1; }
  .progress-legend-swatch.alpha { background: var(--accent); }
  .progress-legend-swatch.planned { background: #BFC9CD; }
  .progress-legend-swatch.parked {
    background: transparent;
    border: 1px dashed #8A9BA3;
    width: 9px;
    height: 9px;
  }
  .breadcrumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 10px 0 18px;
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.01em;
  }
  .breadcrumbs .crumb {
    color: var(--muted);
    text-decoration: none;
  }
  .breadcrumbs a.crumb:hover { color: var(--secondary); }
  .breadcrumbs .crumb-current {
    color: var(--ink);
    font-weight: 600;
  }
  .breadcrumbs .crumb-sep { color: var(--muted); opacity: 0.4; }
  .progress-group { margin-top: 18px; }
  .progress-group:first-child { margin-top: 10px; }
  .progress-group h3 {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink);
    margin-bottom: 4px;
  }
  .progress-group-note {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: none;
    color: var(--muted);
    margin-left: 8px;
  }
  .spec-link {
    color: var(--secondary);
    text-decoration: none;
    border-bottom: 1px solid rgba(47, 124, 122, 0.3);
  }
  .spec-link:hover { border-bottom-color: var(--secondary); }
  .spec-hero .meta {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
  }
  .spec-frontmatter { padding: 18px 22px; margin-top: 14px; }
  .spec-frontmatter h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
  .spec-fm-row { display: flex; gap: 18px; padding: 4px 0; font-size: 13px; }
  .spec-fm-key { min-width: 140px; color: var(--muted); text-transform: capitalize; }
  .spec-fm-val { color: var(--ink); font-weight: 600; }
  .spec-tree { font-size: 14px; }
  .spec-tree-folder {
    border: none;
    padding: 0;
    margin: 2px 0;
  }
  .spec-tree-folder > summary {
    list-style: none;
    cursor: pointer;
  }
  .spec-tree-folder > summary::-webkit-details-marker { display: none; }
  .spec-tree-folder-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px 5px 6px;
    border-radius: 6px;
    font-weight: 600;
    color: var(--ink);
    user-select: none;
  }
  .spec-tree-folder-head:hover { background: rgba(24, 33, 38, 0.04); }
  .spec-tree-chevron {
    width: 10px;
    height: 10px;
    border-right: 1.5px solid var(--muted);
    border-bottom: 1.5px solid var(--muted);
    transform: rotate(-45deg);
    transition: transform 0.12s ease;
    flex-shrink: 0;
    margin-left: 2px;
  }
  .spec-tree-folder[open] > summary .spec-tree-chevron { transform: rotate(45deg); }
  .spec-tree-folder-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    letter-spacing: 0.01em;
  }
  .spec-tree-folder-count {
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    padding: 1px 8px;
    border-radius: 999px;
    background: rgba(24, 33, 38, 0.05);
  }
  .spec-tree-children {
    margin-left: 10px;
    padding-left: 10px;
    border-left: 1px solid var(--line);
    margin-top: 2px;
  }
  .spec-tree-file {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px 6px 6px;
    margin: 1px 0;
    border-radius: 6px;
    text-decoration: none;
    color: inherit;
    position: relative;
  }
  .spec-tree-file:hover { background: rgba(47, 124, 122, 0.07); }
  .spec-tree-file-icon {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--muted);
    flex-shrink: 0;
    margin-left: 6px;
  }
  .spec-tree-file:hover .spec-tree-file-icon { background: var(--secondary); }
  .spec-tree-file-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .spec-tree-file-title { font-size: 13px; font-weight: 500; color: var(--ink); }
  .spec-tree-file-name {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 11px;
    color: var(--muted);
  }
  .spec-tree-file-meta {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .spec-tree-file-meta .status-badge {
    font-size: 10px;
    padding: 2px 7px;
  }
  .preview-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #fff;
    margin-bottom: 14px;
  }
  .preview-search {
    flex: 1 1 240px;
    min-width: 200px;
    padding: 8px 12px;
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 6px;
    outline: none;
  }
  .preview-search:focus { border-color: var(--secondary); box-shadow: 0 0 0 3px rgba(47,124,122,0.1); }
  .preview-filter-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .preview-filter {
    font: inherit;
    font-size: 13px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #fff;
    color: var(--ink);
    outline: none;
    text-transform: none;
    letter-spacing: 0;
  }
  .preview-filter:focus { border-color: var(--secondary); }
  .preview-reset {
    padding: 6px 14px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
  }
  .preview-reset:hover { color: var(--ink); border-color: var(--ink); }
  .preview-count {
    margin-left: auto;
    font-size: 12px;
    color: var(--muted);
  }
  .preview-count-visible { color: var(--ink); font-weight: 700; }
  .preview-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 8px 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    border-bottom: 1px solid var(--line);
    margin-bottom: 6px;
  }
  .preview-header-spec {
    flex: 1;
    min-width: 0;
    padding-left: 20px;
  }
  .preview-anchors-spacer {
    flex: 0 0 70px;
    margin-left: 6px;
  }
  .spec-tree-preview .spec-tree-file { gap: 8px; }
  .spec-tree-preview .spec-tree-file-body { min-width: 200px; }
  .preview-cell {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--ink);
    text-align: left;
  }
  .preview-cell-type { width: 90px; }
  .preview-cell-item { width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-cell-status { width: 130px; }
  .preview-cell-delivery { width: 120px; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .preview-cell-backlog { width: 130px; }
  .rollup-bar-tight { width: 70px; }
  .spec-status-cell { display: inline-flex; align-items: center; gap: 8px; }
  .spec-status-count { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .spec-delivery-cell { font-variant-numeric: tabular-nums; }
  .spec-delivery-arrow { color: var(--line); margin: 0 2px; }
  .spec-delivery-delivered { color: var(--ink); }
  .preview-empty { color: var(--muted); opacity: 0.5; }
  .type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background: rgba(24, 33, 38, 0.06);
    color: var(--ink);
  }
  .type-badge.type-feature { background: rgba(47, 124, 122, 0.12); color: var(--secondary); }
  .type-badge.type-backend { background: rgba(201, 111, 59, 0.12); color: var(--accent); }
  .type-badge.type-release { background: rgba(47, 124, 122, 0.12); color: var(--secondary); }
  .type-badge.type-ops { background: rgba(93, 105, 112, 0.14); color: var(--muted); }
  .type-badge.type-future { background: rgba(24, 33, 38, 0.06); color: var(--muted); font-style: italic; }
  .filtered-out { display: none !important; }
  .spec-tree-file.preview-row {
    position: relative;
    align-items: center;
    padding-right: 10px;
  }
  .spec-tree-file.preview-row:hover { background: rgba(47, 124, 122, 0.06); }
  .preview-row-main {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    text-decoration: none;
    color: inherit;
    padding: 6px 10px 6px 6px;
  }
  .preview-row-main::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 6px;
  }
  .preview-row-main:focus-visible { outline: none; }
  .preview-row-main:focus-visible::after { outline: 2px solid var(--secondary); outline-offset: 2px; }
  .preview-row--child .preview-row-main { padding-left: 34px; }
  .preview-row--child .spec-tree-file-title { color: var(--ink); opacity: 0.86; }
  .preview-row--child::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--line);
    pointer-events: none;
    z-index: 1;
  }
  .preview-anchors {
    position: relative;
    z-index: 2;
    display: flex;
    gap: 4px;
    flex: 0 0 70px;
    justify-content: flex-end;
    margin-left: 6px;
  }
  .preview-anchor {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    height: 22px;
    padding: 0 7px;
    border-radius: 5px;
    background: rgba(24, 33, 38, 0.05);
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-decoration: none;
  }
  .preview-anchor:hover { color: var(--secondary); background: rgba(47, 124, 122, 0.14); }
  .rollup-bar {
    display: inline-flex;
    width: 90px;
    height: 7px;
    border-radius: 999px;
    background: #E6ECEE;
    overflow: hidden;
    margin-left: auto;
  }
  .preview-folder .spec-tree-folder-count { margin-left: 10px; }
  .rollup-seg { display: block; height: 100%; }
  .rollup-seg.shipped { background: var(--secondary); }
  .rollup-seg.beta { background: #6FA9A1; }
  .rollup-seg.alpha { background: var(--accent); }
  .rollup-seg.planned { background: #BFC9CD; }
  .breakdown-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 24px;
  }
  .breakdown-column-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .breakdown-column-head h3 { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }
  .breakdown-open { font-size: 12px; color: var(--muted); text-decoration: none; }
  .breakdown-open:hover { color: var(--secondary); }
  .breakdown-l1 { margin-bottom: 14px; }
  .breakdown-l1:last-child { margin-bottom: 0; }
  .breakdown-row {
    display: grid;
    grid-template-columns: 1fr auto 90px;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 6px;
    color: var(--ink);
    text-decoration: none;
  }
  .breakdown-row:hover { background: rgba(24, 33, 38, 0.04); }
  .breakdown-row-note {
    color: var(--muted);
    font-size: 12px;
    grid-template-columns: 1fr auto;
  }
  .breakdown-row-note:hover { background: none; }
  .breakdown-name { font-weight: 600; font-size: 14px; }
  .breakdown-name-sub { font-weight: 500; padding-left: 16px; color: var(--muted); font-size: 13px; }
  .breakdown-count { font-size: 12px; color: var(--muted); }
  @media (max-width: 1200px) {
    .preview-cell-item { width: 160px; }
  }
  @media (max-width: 960px) {
    .preview-header { display: none; }
    .spec-tree-preview .spec-tree-file { flex-wrap: wrap; }
    .preview-cell-item { display: none; }
    .preview-row--child .preview-row-main { padding-left: 24px; }
  }
  .panel.content {
    font-size: 16px;
    line-height: 1.65;
  }
  .content h1 { display: none; }
  .content h2 {
    font-size: 22px; font-weight: 700; margin-top: 28px; margin-bottom: 12px;
    padding-top: 20px; border-top: 1px solid var(--border); color: var(--ink);
  }
  .content h2:first-child, .content h2:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
  .content h3 { font-size: 17px; font-weight: 700; margin-top: 24px; margin-bottom: 10px; color: var(--ink); }
  .content h4 {
    font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--muted); margin-top: 22px; margin-bottom: 6px;
  }
  .content h5, .content h6 { font-size: 14px; font-weight: 700; margin-top: 18px; margin-bottom: 6px; color: var(--ink); }
  .content p { margin-bottom: 12px; }
  .content ul, .content ol { margin: 0 0 14px 24px; }
  .content li { margin-bottom: 5px; }
  .content strong { font-weight: 700; color: var(--ink); }
  .content a { color: var(--secondary); text-decoration: none; border-bottom: 1px solid rgba(47, 124, 122, 0.28); }
  .content a:hover { border-bottom-color: var(--secondary); }
  .content hr { border: none; height: 1px; background: var(--border); margin: 24px 0; }
  .content blockquote {
    border-left: 3px solid var(--secondary); padding: 10px 16px; margin: 16px 0;
    background: rgba(47, 124, 122, 0.04); color: var(--ink); border-radius: 0 10px 10px 0;
    font-size: 15px;
  }
  .content blockquote p { margin-bottom: 0; }
  .content code {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    background: rgba(53, 56, 59, 0.07);
    padding: 2px 5px; border-radius: 4px; font-size: 13px; color: var(--accent);
    word-break: break-word;
  }
  .content a code { color: var(--secondary); background: rgba(47, 124, 122, 0.08); }
  .content pre {
    background: #182126; color: #F7F9FA; padding: 16px 18px; border-radius: 10px;
    overflow-x: auto; margin: 12px 0 18px; font-size: 13px; line-height: 1.55;
  }
  .content pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
  .content .content-table-scroll { overflow-x: auto; margin: 14px 0 20px; }
  .content .content-table-scroll table {
    width: auto; min-width: min-content; border-collapse: separate; border-spacing: 0;
    border: 1px solid var(--border); border-radius: 10px; overflow: hidden;
    font-size: 14px; background: #fff;
  }
  .content .content-table-scroll thead th {
    background: var(--ink); color: #F7F9FA; text-align: left; padding: 9px 12px;
    font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
  }
  .content .content-table-scroll tbody td {
    padding: 9px 12px; border-bottom: 1px solid var(--border); vertical-align: top;
  }
  .content .content-table-scroll tbody tr:last-child td { border-bottom: none; }
  .content .content-table-scroll tbody tr:nth-child(even) td { background: rgba(243, 246, 245, 0.55); }
  .links {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 18px;
  }
  .links a {
    color: var(--secondary);
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
  }
  .links a:hover { text-decoration: underline; }
  .legal-footer {
    margin-top: 24px;
    padding: 18px 20px;
    border: 1px solid rgba(215, 224, 227, 0.95);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.82);
    box-shadow: 0 10px 28px rgba(21, 32, 40, 0.04);
  }
  .legal-footer-title {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .legal-footer-copy {
    margin-top: 8px;
    max-width: 960px;
    font-size: 12px;
    line-height: 1.55;
    color: var(--muted);
  }
  @media (max-width: 1000px) {
    .topbar {
      flex-wrap: nowrap;
    }
    .topbar-brand {
      width: auto;
      flex: 0 0 auto;
      border-right: 0;
      padding: 0 12px 0 16px;
    }
    .topbar-menu-btn { display: flex; align-items: center; flex-shrink: 0; }
    .topbar-nav { display: none; }
    .topbar-search {
      flex: 1;
      min-width: 0;
      border-left: 0;
      padding: 0 12px 0 0;
    }
    .topbar-search .search-input {
      width: 100%;
      min-width: 0;
    }
    .sidebar {
      top: 52px;
      left: 0;
      bottom: 0;
      width: 260px;
      max-width: 82vw;
      height: calc(100vh - 52px);
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      box-shadow: 0 20px 40px rgba(21,32,40,0.14);
      z-index: 30;
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .main {
      width: 100%;
      margin-left: 0;
    }
  }
  @media (max-width: 700px) {
    body { padding-top: 0; display: block; }
    .topbar {
      position: static;
      display: block;
      height: auto;
    }
    .topbar-brand {
      width: 100%;
      border-bottom: 1px solid var(--line);
      padding: 14px 18px;
    }
    .topbar-nav { padding: 10px 12px 12px; }
    .topbar-search {
      border-top: 1px solid #D7E0E3;
      padding: 12px;
    }
    .topbar-search .search-input { width: 100%; }
    .topbar-breadcrumb { display: none; }
    .layout { display: block; width: 100%; }
    .sidebar {
      position: fixed;
      top: 52px;
      left: 0;
      bottom: 0;
      width: 260px;
      max-width: 82vw;
      height: calc(100vh - 52px);
      border-right: 1px solid #D7E0E3;
      border-bottom: 0;
      transform: translateX(-100%);
      transition: transform 0.2s ease;
      box-shadow: 0 20px 40px rgba(21,32,40,0.14);
      z-index: 30;
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .sidebar-header {
      padding: 20px 16px 16px;
      border-bottom: 1px solid #D7E0E3;
    }
    .nav-section-title { padding: 12px 16px 6px; }
    .sidebar-link { padding: 7px 16px 7px 24px; }
    .main { width: 100%; margin-left: 0; padding: 20px 0 56px; }
    .shell { width: 100%; padding: 0 14px; }
    .hero { padding: 40px 22px 24px; }
    .panel { padding: 20px 18px 18px; }
    .source-row { display: block; }
  }
  @media (max-width: 1000px) {
    table { min-width: 880px; }
    th.col-spec, td.col-spec { display: none; }
  }
</style>
</head>
<body>
  ${buildTopbar(sections, activeSectionSlug)}
  <div class="layout">
    ${buildSidebar(sections, activeSectionSlug, activePageKey)}
    <main class="main">
      <div class="shell">${body}${LEGAL_NOTICE_HTML}</div>
    </main>
  </div>
  <script>
  (function() {
    var topbar = document.getElementById('topbar');
    if (!topbar) return;
    document.addEventListener('keydown', function(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        var inp = topbar.querySelector('.search-input');
        if (inp) { inp.focus(); inp.select(); }
      }
    });
  })();
  </script>
  ${SEARCH_SCRIPT}
</body>
</html>`;
    }
    if (!existsSync(SNAPSHOT_PATH)) {
        throw new Error(`Missing snapshot: ${SNAPSHOT_PATH}. Run npm run docs:roadmaps:aggregate first.`);
    }
    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    ensureDir(OUTPUT_DIR);
    ensureDir(join(OUTPUT_DIR, 'data'));
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    const sections = buildSections(snapshot);
    SINGLE_SOURCE_MODE = snapshot.sources.filter((s) => s.status === 'ok').length <= 1;
    const sourceHandles = snapshot.sources
        .filter((s) => s.status === 'ok')
        .map((s) => ({
        id: s.id,
        label: s.label,
        slug: sourceIdToSlug(s.id),
        resolvedRoot: resolve(ROOT, s.resolvedRoot),
        originRoot: resolve(ROOT, s.originRoot),
    }));
    const allSpecs = [];
    for (const handle of sourceHandles) {
        const files = collectSpecFiles(handle.id, handle.resolvedRoot);
        for (const file of files)
            allSpecs.push(loadSpec(handle, file));
    }
    // In single-source mode, simplify per-spec URLs: drop the source-slug
    // directory, and strip the redundant leading `specs/` segment (which
    // just names the docs/specs/ source directory).
    if (SINGLE_SOURCE_MODE) {
        for (const spec of allSpecs) {
            const parts = spec.url.split('/');
            if (parts[0] === spec.sourceSlug)
                parts.shift();
            if (parts[0] === 'specs')
                parts.shift();
            spec.url = parts.join('/');
        }
    }
    const specIndex = buildSpecIndex(allSpecs, sourceHandles);
    const specsBySource = new Map();
    for (const spec of allSpecs) {
        const list = specsBySource.get(spec.sourceId) || [];
        list.push(spec);
        specsBySource.set(spec.sourceId, list);
    }
    const specPathToUrl = new Map();
    const specPathToTitle = new Map();
    for (const spec of allSpecs) {
        specPathToUrl.set(spec.specPath, spec.url);
        specPathToTitle.set(spec.specPath, spec.title);
    }
    const specBucketByPath = new Map();
    const specStatsByPath = new Map();
    const specBacklogStatsByPath = new Map();
    {
        const rank = { shipped: 4, beta: 3, alpha: 2, planned: 1, parked: 0 };
        const subfeatureStatusToBucket = (status) => {
            const v = status.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
            if (!v)
                return null;
            if (v === 'done' || v === 'implemented' || v === 'shipped')
                return 'shipped';
            if (v === 'in progress' || v === 'alpha' || v === 'started')
                return 'alpha';
            if (v === 'planned' || v === 'open')
                return 'planned';
            if (v === 'deferred' || v === 'parked')
                return 'parked';
            return null;
        };
        const getStats = (key) => {
            let s = specStatsByPath.get(key);
            if (!s) {
                s = { bucket: null, done: 0, inProgress: 0, planned: 0, parked: 0, total: 0, targets: new Set(), delivered: new Set() };
                specStatsByPath.set(key, s);
            }
            return s;
        };
        const normalizeVersion = (v) => v.replace(/\s*\([^)]*\)\s*$/, '').trim();
        for (const row of snapshot.tables.subfeatures?.rows || []) {
            const bucket = subfeatureStatusToBucket(String(row.Status || ''));
            const stats = getStats(row.Spec);
            stats.total += 1;
            if (bucket === 'shipped')
                stats.done += 1;
            else if (bucket === 'alpha' || bucket === 'beta')
                stats.inProgress += 1;
            else if (bucket === 'planned')
                stats.planned += 1;
            else if (bucket === 'parked')
                stats.parked += 1;
            const target = normalizeVersion(String(row.Target || ''));
            if (target && target !== '—' && target !== '-')
                stats.targets.add(target);
            const delivered = normalizeVersion(String(row.Delivered || ''));
            if (delivered && delivered !== '—' && delivered !== '-')
                stats.delivered.add(delivered);
            if (bucket) {
                const existing = specBucketByPath.get(row.Spec);
                if (!existing || rank[bucket] > rank[existing]) {
                    specBucketByPath.set(row.Spec, bucket);
                }
            }
        }
        for (const [key, s] of specStatsByPath) {
            s.bucket = specBucketByPath.get(key) || null;
        }
        // Backlog stats — distinct vocabulary from subfeatures.
        const classifyBacklog = (status) => {
            const v = status.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
            if (!v)
                return null;
            if (v === 'resolved' || v === 'done' || v === 'closed')
                return 'resolved';
            if (v === 'in progress' || v === 'started' || v === 'drafted')
                return 'inProgress';
            if (v === 'open' || v === 'triaged' || v === 'planned')
                return 'open';
            if (v === 'parked' || v === 'deferred')
                return 'parked';
            return null;
        };
        for (const row of snapshot.tables.backlog?.rows || []) {
            let s = specBacklogStatsByPath.get(row.Spec);
            if (!s) {
                s = { resolved: 0, inProgress: 0, open: 0, parked: 0, total: 0 };
                specBacklogStatsByPath.set(row.Spec, s);
            }
            s.total += 1;
            const b = classifyBacklog(String(row.Status || ''));
            if (b)
                s[b] += 1;
        }
    }
    function renderSpecBacklogCell(stats) {
        if (!stats || stats.total === 0)
            return '<span class="preview-empty">—</span>';
        const seg = (n, cls) => n > 0 ? `<span class="rollup-seg ${cls}" style="width:${(n / stats.total) * 100}%"></span>` : '';
        const bar = `<span class="rollup-bar rollup-bar-tight">${seg(stats.resolved, 'shipped')}${seg(stats.inProgress, 'alpha')}${seg(stats.open, 'planned')}</span>`;
        return `<span class="spec-status-cell">${bar}<span class="spec-status-count">${stats.resolved}/${stats.total}</span></span>`;
    }
    function renderSpecStatusCell(stats) {
        if (!stats || stats.total === 0)
            return '<span class="preview-empty">—</span>';
        const seg = (n, cls) => n > 0 ? `<span class="rollup-seg ${cls}" style="width:${(n / stats.total) * 100}%"></span>` : '';
        const bar = `<span class="rollup-bar rollup-bar-tight">${seg(stats.done, 'shipped')}${seg(stats.inProgress, 'alpha')}${seg(stats.planned, 'planned')}</span>`;
        return `<span class="spec-status-cell">${bar}<span class="spec-status-count">${stats.done}/${stats.total}</span></span>`;
    }
    function renderSpecDeliveryCell(stats) {
        if (!stats || stats.total === 0)
            return '<span class="preview-empty">—</span>';
        const sortV = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        const targets = [...stats.targets].sort(sortV);
        const delivered = [...stats.delivered].sort(sortV);
        const targetStr = targets.length === 0 ? '—' : targets.length === 1 ? targets[0] : `${targets[0]}…${targets[targets.length - 1]}`;
        const deliveredStr = delivered.length === 0 ? '—' : delivered[delivered.length - 1];
        return `<span class="spec-delivery-cell"><span class="spec-delivery-target">${escHtml(targetStr)}</span> <span class="spec-delivery-arrow">→</span> <span class="spec-delivery-delivered">${escHtml(deliveredStr)}</span></span>`;
    }
    for (const section of sections) {
        const specsForSection = section.source
            ? specsBySource.get(section.source.id) || []
            : allSpecs;
        if (specsForSection.length > 0) {
            const specsPage = {
                key: 'browse',
                label: 'Specs',
                href: routeFor(section.slug, 'browse'),
            };
            const hasOverview = section.pages.some((p) => p.key === 'index');
            if (hasOverview) {
                section.pages.push(specsPage);
            }
            else {
                // No Overview in this mode — Specs becomes the section's entry page.
                section.pages.unshift(specsPage);
            }
        }
    }
    copyFileSync(SNAPSHOT_PATH, join(OUTPUT_DIR, 'roadmaps.json'));
    const searchIndex = [
        {
            title: 'Roadmaps Overview',
            section: 'Overview',
            group: '',
            snippet: 'Roadmaps home with portfolio and workstream sections.',
            url: 'index.html',
        },
        {
            title: 'Search',
            section: 'Overview',
            group: '',
            snippet: 'Search across roadmap views, tracked rows, and workstream sections.',
            url: 'search.html',
        },
    ];
    for (const section of sections) {
        // In single-source mode nothing is written under the section slug dir
        // (Overview, tables, and the filterable browser all live at the root).
        if (!SINGLE_SOURCE_MODE)
            ensureDir(join(OUTPUT_DIR, section.slug));
        const sectionCards = section.pages
            .filter((page) => page.key !== 'index')
            .map((page) => {
            if (page.key === 'browse') {
                const specs = section.source
                    ? specsBySource.get(section.source.id) || []
                    : allSpecs;
                return `
      <a class="card" href="${page.href}">
        <h2>${escHtml(page.label)}</h2>
        <p>Browse and filter ${specs.length} specs by roadmap metadata</p>
        <div class="jump">Open ${escHtml(page.label)} &rarr;</div>
      </a>`;
            }
            const table = snapshot.tables[page.key];
            const rows = table ? sectionRows(section, table) : [];
            const scope = TABLE_SCOPE[page.key];
            const progress = scope ? getProgressCount(snapshot, scope, section.source?.id) : null;
            const progressHtml = renderProgress(progress, { compact: true });
            return `
      <a class="card" href="${page.href}">
        <h2>${escHtml(page.label)}</h2>
        <p>${rows.length} tracked rows</p>
        ${progressHtml}
        <div class="jump">Open ${escHtml(page.label)} &rarr;</div>
      </a>`;
        })
            .join('');
        const sourcePanel = section.source
            ? `
    <section class="panel">
      <h2>Source</h2>
      <div class="source-list">
        <div class="source-row">
          <div>
            <strong>${escHtml(section.source.label)}</strong>
            <div class="source-meta">${escHtml(section.source.id)}</div>
            <div class="source-meta">${escHtml(section.source.configuredRoot)}</div>
          </div>
          <div>
            <div><span class="status-badge status-${statusTone(section.source.status)}">${escHtml(section.source.status)}</span></div>
            <div class="source-meta" style="margin-top:8px;">${section.source.trackedFiles} tracked files</div>
          </div>
        </div>
      </div>
    </section>`
            : `
    <section class="panel">
      <h2>Sources</h2>
      <div class="source-list">
        ${snapshot.sources
                .map((source) => `
        <div class="source-row">
          <div>
            <strong>${escHtml(source.label)}</strong>
            <div class="source-meta">${escHtml(source.id)}</div>
            <div class="source-meta">${escHtml(source.configuredRoot)}</div>
          </div>
          <div>
            <div><span class="status-badge status-${statusTone(source.status)}">${escHtml(source.status)}</span></div>
            <div class="source-meta" style="margin-top:8px;">${source.trackedFiles} tracked files</div>
          </div>
        </div>`)
                .join('')}
      </div>
    </section>`;
        const sectionDelivery = getProgressCount(snapshot, 'delivery', section.source?.id);
        const sectionBacklog = getProgressCount(snapshot, 'backlog', section.source?.id);
        const progressPanel = (sectionDelivery || sectionBacklog)
            ? `
    <section class="panel">
      <h2>Progress</h2>
      ${sectionDelivery ? `<div class="progress-group"><h3>Delivery <span class="progress-group-note">Subfeatures — see each spec page for detail</span></h3>${renderProgress(sectionDelivery)}</div>` : ''}
      ${sectionBacklog ? `<div class="progress-group"><h3>Backlog <span class="progress-group-note">Open questions — see each spec page for detail</span></h3>${renderProgress(sectionBacklog)}</div>` : ''}
    </section>`
            : '';
        const sectionCrumbs = renderBreadcrumbs([
            { label: 'Roadmaps', href: 'index.html' },
            { label: section.label },
        ]);
        const overviewBody = `
    <section class="hero">
      <div class="eyebrow">Kinetiq Core</div>
      ${sectionCrumbs}
      <h1>${escHtml(section.label)}</h1>
      <p class="subhead">${section.source ? `Repository-specific roadmap views for ${escHtml(section.source.label)}.` : 'Combined cross-repo roadmap views across all configured sources.'}</p>
      <div class="meta">Snapshot generated ${escHtml(snapshot.generatedAt)} via ${escHtml(snapshot.generatedBy)}</div>
      ${PROGRESS_LEGEND_HTML}
      <div class="links">
        <a href="index.html">Roadmaps home</a>
        <a href="roadmaps.json">Snapshot JSON</a>
      </div>
      <div class="grid">${sectionCards || '<div class="source-meta">No roadmap views available for this section.</div>'}</div>
    </section>
    ${progressPanel}
    ${sourcePanel}
  `;
        // Skip the section-overview write in single-source mode — the root
        // index already covers this ground (overall progress + L1/L2 breakdown).
        if (section.pages.some((p) => p.key === 'index')) {
            const pagePath = routeFor(section.slug, 'index');
            writeFileSync(join(OUTPUT_DIR, pagePath), pageShell(`${section.label} — Roadmaps`, sections, section.slug, 'index', overviewBody, pagePath));
            searchIndex.push({
                title: `${section.label} Overview`,
                section: section.label,
                group: '',
                snippet: section.source ? `Repository-specific roadmap views for ${section.source.label}.` : 'Combined cross-repo roadmap views.',
                url: routeFor(section.slug, 'index'),
            });
        }
        for (const page of section.pages) {
            if (page.key === 'index' || page.key === 'browse')
                continue;
            const table = snapshot.tables[page.key];
            if (!table)
                continue;
            const rows = sectionRows(section, table);
            if (!rows.length)
                continue;
            writeFileSync(join(OUTPUT_DIR, csvRouteFor(section.slug, page.key)), toCsv(table.headers, rows));
            const headerHtml = table.headers
                .filter((header) => header !== 'Repository')
                .map((header) => {
                const cls = columnClass(header);
                return `<th${cls ? ` class="${cls}"` : ''}>${escHtml(header)}</th>`;
            })
                .join('');
            const grouping = TABLE_GROUPING[page.key];
            const orderedRows = grouping ? sortByGrouping(rows, grouping) : rows;
            const visibleHeaders = table.headers.filter((header) => header !== 'Repository');
            let currentGroup = null;
            const renderedRowChunks = [];
            for (const row of orderedRows) {
                if (grouping) {
                    const groupValue = row[grouping.groupColumn] || '(ungrouped)';
                    if (groupValue !== currentGroup) {
                        currentGroup = groupValue;
                        const isSpecGroup = grouping.groupColumn === 'Spec';
                        const displayLabel = isSpecGroup ? specPathToTitle.get(groupValue) || groupValue : groupValue;
                        const specUrl = isSpecGroup ? specPathToUrl.get(groupValue) : null;
                        const valueHtml = specUrl
                            ? `<a class="group-header-value" href="${escHtml(specUrl)}">${escHtml(displayLabel)}</a>`
                            : `<span class="group-header-value">${escHtml(displayLabel)}</span>`;
                        const pathHtml = isSpecGroup ? `<span class="group-header-path">${escHtml(groupValue)}</span>` : '';
                        renderedRowChunks.push(`
      <tr class="group-header">
        <td colspan="${visibleHeaders.length}">
          <span class="group-header-label">${escHtml(grouping.groupColumn)}</span>
          ${valueHtml}
          ${pathHtml}
        </td>
      </tr>`);
                    }
                }
                const cells = visibleHeaders
                    .map((header) => {
                    const cls = columnClass(header);
                    const raw = row[header] || '';
                    let cellHtml;
                    if (header === 'Spec' && raw) {
                        const specUrl = specPathToUrl.get(raw);
                        cellHtml = specUrl
                            ? `<a class="spec-link" href="${escHtml(specUrl)}">${escHtml(raw)}</a>`
                            : escHtml(raw);
                    }
                    else {
                        cellHtml = renderCell(header, raw);
                    }
                    return `<td${cls ? ` class="${cls}"` : ''}>${cellHtml}</td>`;
                })
                    .join('');
                renderedRowChunks.push(`
      <tr>
        ${cells}
      </tr>`);
            }
            const rowsHtml = renderedRowChunks.join('');
            const tableScope = TABLE_SCOPE[page.key];
            const tableProgress = tableScope ? getProgressCount(snapshot, tableScope, section.source?.id) : null;
            const tableProgressHtml = renderProgress(tableProgress);
            const tableCrumbs = renderBreadcrumbs([
                { label: 'Roadmaps', href: 'index.html' },
                { label: section.label, href: routeFor(section.slug, 'index') },
                { label: table.title },
            ]);
            const body = `
      <section class="hero">
        <div class="eyebrow">Kinetiq Core</div>
        ${tableCrumbs}
        <h1>${escHtml(section.label)} — ${escHtml(table.title)}</h1>
        <p class="subhead">${rows.length} rows in this workstream view.</p>
        ${tableProgress ? PROGRESS_LEGEND_HTML : ''}
        ${tableProgressHtml}
        <div class="links">
          <a href="${section.pages[0]?.href}">${escHtml(section.label)} overview</a>
          <a href="${escHtml(csvRouteFor(section.slug, page.key))}">Download CSV</a>
        </div>
      </section>
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </section>
    `;
            {
                const pagePath = routeFor(section.slug, page.key);
                writeFileSync(join(OUTPUT_DIR, pagePath), pageShell(`${section.label} — ${table.title}`, sections, section.slug, page.key, body, pagePath));
            }
            searchIndex.push({
                title: `${section.label} — ${table.title}`,
                section: section.label,
                group: table.title,
                snippet: `${rows.length} rows in this workstream view.`,
                url: routeFor(section.slug, page.key),
            });
            for (const row of rows) {
                const titleField = row.Feature || row.Capability || row.Subfeature || row.Item || row.Spec || table.title;
                const snippet = table.headers.map((header) => `${header}: ${row[header] || ''}`).join(' | ');
                searchIndex.push({
                    title: `${section.label}: ${titleField}`,
                    section: section.label,
                    group: table.title,
                    snippet,
                    url: routeFor(section.slug, page.key),
                });
            }
        }
    }
    for (const tableKey of ['subfeatures', 'backlog']) {
        const table = snapshot.tables[tableKey];
        if (!table)
            continue;
        for (const row of table.rows) {
            const titleField = row.Subfeature || row.Item || row.Key || tableKey;
            const specUrl = row.Spec ? specPathToUrl.get(row.Spec) : undefined;
            if (!specUrl)
                continue;
            const snippet = table.headers.map((header) => `${header}: ${row[header] || ''}`).join(' | ');
            searchIndex.push({
                title: `${row.Source || ''}: ${titleField}`,
                section: row.Source || '',
                group: table.title,
                snippet,
                url: specUrl,
            });
        }
    }
    let specsRenderedCount = 0;
    let specsWarnCount = 0;
    for (const spec of allSpecs) {
        const rendered = renderSpec(spec, specIndex);
        specsRenderedCount += 1;
        specsWarnCount += rendered.warnings.length;
        for (const w of rendered.warnings)
            console.warn(`[specs] ${w}`);
        const outPath = join(OUTPUT_DIR, spec.url);
        ensureDir(dirname(outPath));
        const backToSpecsHref = routeFor(spec.sourceSlug, 'browse');
        const backToSectionHref = routeFor(spec.sourceSlug, 'index');
        const pathSegments = spec.relPath.split('/').filter(Boolean);
        const folderSegments = pathSegments.slice(0, -1);
        if (folderSegments[0] === 'specs')
            folderSegments.shift();
        const specCrumbs = renderBreadcrumbs([
            { label: 'Roadmaps', href: 'index.html' },
            { label: spec.sourceLabel, href: backToSectionHref },
            { label: 'Specs', href: backToSpecsHref },
            ...folderSegments.map((seg) => ({ label: seg })),
            { label: rendered.title },
        ]);
        const frontmatterPairs = Object.entries(spec.frontmatter)
            .filter(([k]) => k.startsWith('roadmap_'))
            .map(([k, v]) => `<div class="spec-fm-row"><span class="spec-fm-key">${escHtml(k.replace(/^roadmap_/, '').replace(/_/g, ' '))}</span><span class="spec-fm-val">${escHtml(v)}</span></div>`)
            .join('');
        const frontmatterPanel = frontmatterPairs
            ? `<section class="panel spec-frontmatter"><h2>Tracking metadata</h2>${frontmatterPairs}</section>`
            : '';
        const specBody = `
    <section class="hero spec-hero">
      <div class="eyebrow">${escHtml(spec.sourceLabel)}</div>
      ${specCrumbs}
      <h1>${escHtml(rendered.title)}</h1>
      <div class="meta">${escHtml(spec.specPath)}</div>
    </section>
    ${frontmatterPanel}
    <section class="panel content">${rendered.html}</section>
  `;
        writeFileSync(outPath, pageShell(`${rendered.title} — ${spec.sourceLabel}`, sections, spec.sourceSlug, 'browse', specBody, spec.url));
        searchIndex.push({
            title: rendered.title,
            section: spec.sourceLabel,
            group: 'Specs',
            snippet: `${spec.specPath} — ${rendered.headings.slice(0, 5).map((h) => h.text).join(' · ')}`,
            url: spec.url,
        });
    }
    if (specsRenderedCount)
        console.warn(`Rendered ${specsRenderedCount} spec pages${specsWarnCount ? ` (${specsWarnCount} link warnings)` : ''}`);
    function newTreeNode(name) {
        return { name, children: new Map(), files: [] };
    }
    function insertSpec(root, segments, spec) {
        if (segments.length === 0) {
            root.files.push(spec);
            return;
        }
        const [head, ...rest] = segments;
        let child = root.children.get(head);
        if (!child) {
            child = newTreeNode(head);
            root.children.set(head, child);
        }
        insertSpec(child, rest, spec);
    }
    function countTreeFiles(node) {
        let n = node.files.length;
        for (const child of node.children.values())
            n += countTreeFiles(child);
        return n;
    }
    function extractPreviewRow(fm) {
        const hasMobileFeature = !!(fm.roadmap_mobile_feature_item || fm.roadmap_mobile_feature_group);
        const hasWebFeature = !!(fm.roadmap_web_feature_item || fm.roadmap_web_feature_group);
        let type = '';
        if (hasMobileFeature && hasWebFeature)
            type = 'feature';
        else if (hasMobileFeature)
            type = 'mobile-feature';
        else if (hasWebFeature)
            type = 'web-feature';
        else if (fm.roadmap_type === 'feature' || fm.roadmap_feature_item)
            type = 'feature';
        else if (fm.roadmap_type === 'backend' || fm.roadmap_backend_item)
            type = 'backend';
        else if (fm.roadmap_release_item)
            type = 'release';
        else if (fm.roadmap_ops_item)
            type = 'ops';
        else if (fm.roadmap_future_item)
            type = 'future';
        const surfaces = [];
        if (hasMobileFeature)
            surfaces.push('Mobile');
        if (hasWebFeature)
            surfaces.push('Web');
        return {
            type,
            group: fm.roadmap_mobile_feature_group ||
                fm.roadmap_web_feature_group ||
                fm.roadmap_backend_group ||
                fm.roadmap_release_group ||
                fm.roadmap_ops_group ||
                fm.roadmap_future_group ||
                fm.roadmap_feature_group ||
                fm.roadmap_group ||
                '',
            item: fm.roadmap_mobile_feature_item ||
                fm.roadmap_web_feature_item ||
                fm.roadmap_backend_item ||
                fm.roadmap_release_item ||
                fm.roadmap_ops_item ||
                fm.roadmap_future_item ||
                fm.roadmap_feature_item ||
                fm.roadmap_item ||
                '',
            phase: fm.roadmap_mobile_feature_phase ||
                fm.roadmap_web_feature_phase ||
                fm.roadmap_backend_phase ||
                fm.roadmap_release_phase ||
                fm.roadmap_ops_phase ||
                fm.roadmap_feature_phase ||
                fm.roadmap_phase ||
                '',
            surfaces: surfaces.join(', '),
            horizon: fm.roadmap_future_horizon || '',
        };
    }
    function classifyPreviewValue(value) {
        const v = value.toLowerCase().trim();
        if (!v || v === '-' || v === '—')
            return null;
        if (v === 'ready')
            return 'shipped';
        if (v === 'beta')
            return 'beta';
        if (v === 'alpha' || v === 'started')
            return 'alpha';
        if (v === 'planned' || v === 'draft' || v === 'placeholder')
            return 'planned';
        if (v === 'parked')
            return 'parked';
        return null;
    }
    function classifyPreviewSpec(spec) {
        const row = extractPreviewRow(spec.frontmatter);
        if (row.phase.toLowerCase() === 'parked')
            return 'parked';
        // v3: the spec's bucket is the best of its subfeature statuses,
        // precomputed from snapshot.tables.subfeatures.
        return specBucketByPath.get(spec.specPath) || null;
    }
    function rollupTreeNode(node) {
        const roll = { shipped: 0, beta: 0, alpha: 0, planned: 0, parked: 0, tracked: 0, total: 0 };
        for (const file of node.files) {
            roll.total += 1;
            const bucket = classifyPreviewSpec(file);
            if (bucket) {
                roll[bucket] += 1;
                roll.tracked += 1;
            }
        }
        for (const child of node.children.values()) {
            const childRoll = rollupTreeNode(child);
            roll.shipped += childRoll.shipped;
            roll.beta += childRoll.beta;
            roll.alpha += childRoll.alpha;
            roll.planned += childRoll.planned;
            roll.parked += childRoll.parked;
            roll.tracked += childRoll.tracked;
            roll.total += childRoll.total;
        }
        return roll;
    }
    function renderRollupBar(roll) {
        const denom = roll.shipped + roll.beta + roll.alpha + roll.planned;
        if (denom === 0)
            return '';
        const seg = (count, cls) => count > 0 ? `<span class="rollup-seg ${cls}" style="width:${(count / denom) * 100}%"></span>` : '';
        const tip = [
            roll.shipped && `${roll.shipped} shipped`,
            roll.beta && `${roll.beta} beta`,
            roll.alpha && `${roll.alpha} alpha`,
            roll.planned && `${roll.planned} planned`,
            roll.parked && `${roll.parked} parked`,
        ]
            .filter(Boolean)
            .join(' · ');
        return `<span class="rollup-bar" title="${escAttr(tip)}">${seg(roll.shipped, 'shipped')}${seg(roll.beta, 'beta')}${seg(roll.alpha, 'alpha')}${seg(roll.planned, 'planned')}</span>`;
    }
    function groupParentChildFiles(files) {
        const bases = new Map();
        for (const spec of files) {
            const base = (spec.relPath.split('/').pop() || '').replace(/\.md$/, '');
            bases.set(base, spec);
        }
        const parentBases = new Set();
        for (const a of bases.keys()) {
            for (const b of bases.keys()) {
                if (a !== b && b.startsWith(a + '_')) {
                    parentBases.add(a);
                    break;
                }
            }
        }
        const childrenByParent = new Map();
        const topLevel = [];
        for (const [base, spec] of bases) {
            if (parentBases.has(base)) {
                topLevel.push(spec);
                if (!childrenByParent.has(base))
                    childrenByParent.set(base, []);
                continue;
            }
            let matched = null;
            for (const parentBase of parentBases) {
                if (base.startsWith(parentBase + '_')) {
                    if (!matched || parentBase.length > matched.length)
                        matched = parentBase;
                }
            }
            if (matched) {
                if (!childrenByParent.has(matched))
                    childrenByParent.set(matched, []);
                childrenByParent.get(matched).push(spec);
            }
            else {
                topLevel.push(spec);
            }
        }
        topLevel.sort((a, b) => a.title.localeCompare(b.title));
        for (const list of childrenByParent.values())
            list.sort((a, b) => a.title.localeCompare(b.title));
        return topLevel.map((parent) => {
            const base = (parent.relPath.split('/').pop() || '').replace(/\.md$/, '');
            return { parent, children: childrenByParent.get(base) || [] };
        });
    }
    function renderPreviewLeaf(spec, isChild) {
        const filename = spec.relPath.split('/').pop() || spec.relPath;
        const row = extractPreviewRow(spec.frontmatter);
        const searchText = [spec.title, spec.relPath, row.group, row.item].filter(Boolean).join(' ').toLowerCase();
        const dataAttrs = [
            `data-search="${escAttr(searchText)}"`,
            `data-type="${escAttr(row.type || '—')}"`,
        ].join(' ');
        const classes = `spec-tree-file preview-row${isChild ? ' preview-row--child' : ''}`;
        return `<div class="${classes}" ${dataAttrs}>
    <a class="preview-row-main" href="${escHtml(spec.url)}">
      <span class="spec-tree-file-icon" aria-hidden="true"></span>
      <span class="spec-tree-file-body">
        <span class="spec-tree-file-title">${escHtml(spec.title)}</span>
        <span class="spec-tree-file-name">${escHtml(filename)}</span>
      </span>
    </a>
    <span class="preview-cell preview-cell-type">${row.type ? `<span class="type-badge type-${escAttr(row.type)}">${escHtml(row.type)}</span>` : '<span class="preview-empty">—</span>'}</span>
    <span class="preview-cell preview-cell-item" title="${escAttr(row.item)}">${row.item ? escHtml(row.item) : '<span class="preview-empty">—</span>'}</span>
    <span class="preview-cell preview-cell-status">${renderSpecStatusCell(specStatsByPath.get(spec.specPath))}</span>
    <span class="preview-cell preview-cell-delivery">${renderSpecDeliveryCell(specStatsByPath.get(spec.specPath))}</span>
    <span class="preview-cell preview-cell-backlog">${renderSpecBacklogCell(specBacklogStatsByPath.get(spec.specPath))}</span>
  </div>`;
    }
    function renderPreviewTreeNode(node, depth) {
        const folderEntries = [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b));
        let html = '';
        for (const [name, child] of folderEntries) {
            const count = countTreeFiles(child);
            const roll = rollupTreeNode(child);
            const inner = renderPreviewTreeNode(child, depth + 1);
            const isOpen = depth < 2;
            html += `<details class="spec-tree-folder preview-folder"${isOpen ? ' open' : ''}>
      <summary class="spec-tree-folder-head">
        <span class="spec-tree-chevron" aria-hidden="true"></span>
        <span class="spec-tree-folder-name">${escHtml(name)}</span>
        ${renderRollupBar(roll)}
        <span class="spec-tree-folder-count">${count}</span>
      </summary>
      <div class="spec-tree-children">${inner}</div>
    </details>`;
        }
        const groups = groupParentChildFiles(node.files);
        for (const { parent, children } of groups) {
            html += renderPreviewLeaf(parent, false);
            for (const child of children)
                html += renderPreviewLeaf(child, true);
        }
        return html;
    }
    function escAttr(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function distinctValues(specs, fieldPicker) {
        const set = new Set();
        for (const spec of specs) {
            const v = fieldPicker(extractPreviewRow(spec.frontmatter));
            if (v)
                set.add(v);
        }
        return [...set].sort((a, b) => a.localeCompare(b));
    }
    function renderFilterSelect(field, label, values) {
        if (!values.length)
            return '';
        const options = [`<option value="">All ${escHtml(label.toLowerCase())}</option>`];
        for (const v of values)
            options.push(`<option value="${escAttr(v)}">${escHtml(v)}</option>`);
        return `<label class="preview-filter-label">${escHtml(label)}<select class="preview-filter" data-field="${escAttr(field)}">${options.join('')}</select></label>`;
    }
    const PREVIEW_SCRIPT = `
<script>
(function () {
  var root = document.getElementById('specs-preview-root');
  if (!root) return;
  var searchInput = root.querySelector('.preview-search');
  var selects = root.querySelectorAll('.preview-filter');
  var resetBtn = root.querySelector('.preview-reset');
  var countEl = root.querySelector('.preview-count-visible');
  var rows = root.querySelectorAll('.preview-row');
  var folders = root.querySelectorAll('.preview-folder');
  var total = rows.length;

  function apply() {
    var text = (searchInput.value || '').trim().toLowerCase();
    var filters = {};
    selects.forEach(function (s) { if (s.value) filters[s.dataset.field] = s.value; });

    var visible = 0;
    rows.forEach(function (row) {
      var matchText = !text || (row.dataset.search || '').indexOf(text) !== -1;
      var matchFilters = Object.keys(filters).every(function (f) { return row.dataset[f] === filters[f]; });
      var show = matchText && matchFilters;
      row.classList.toggle('filtered-out', !show);
      if (show) visible += 1;
    });

    folders.forEach(function (folder) {
      var anyVisible = folder.querySelector('.preview-row:not(.filtered-out)');
      folder.classList.toggle('filtered-out', !anyVisible);
    });

    if (countEl) countEl.textContent = visible + ' of ' + total;
  }

  searchInput && searchInput.addEventListener('input', apply);
  selects.forEach(function (s) { s.addEventListener('change', apply); });
  resetBtn && resetBtn.addEventListener('click', function () {
    if (searchInput) searchInput.value = '';
    selects.forEach(function (s) { s.value = ''; });
    apply();
  });

  var params = new URLSearchParams(window.location.search);
  var initialQ = params.get('q');
  if (initialQ && searchInput) {
    searchInput.value = initialQ;
    apply();
  }
})();
</script>`;
    for (const section of sections) {
        const hasSpecsPage = section.pages.some((p) => p.key === 'browse');
        if (!hasSpecsPage)
            continue;
        const specs = section.source
            ? specsBySource.get(section.source.id) || []
            : allSpecs.slice();
        const previewRoot = newTreeNode('');
        for (const spec of specs) {
            let segments = spec.relPath.split('/').filter(Boolean);
            if (segments[0] === 'specs')
                segments = segments.slice(1);
            const folderSegments = segments.slice(0, -1);
            const prefix = section.source ? [] : [spec.sourceLabel];
            insertSpec(previewRoot, [...prefix, ...folderSegments], spec);
        }
        const indexUrl = routeFor(section.slug, 'browse');
        const specsCrumbs = renderBreadcrumbs([
            { label: 'Roadmaps', href: 'index.html' },
            { label: section.label, href: routeFor(section.slug, 'index') },
            { label: 'Specs' },
        ]);
        const typeValues = distinctValues(specs, (r) => r.type);
        const filterBar = `
    <div class="preview-controls">
      <input type="text" class="preview-search" placeholder="Filter by title, path, item…" />
      ${renderFilterSelect('type', 'Type', typeValues)}
      <button type="button" class="preview-reset">Reset</button>
      <span class="preview-count"><span class="preview-count-visible">${specs.length} of ${specs.length}</span> specs</span>
    </div>`;
        const headerStrip = `
    <div class="preview-header">
      <span class="preview-header-spec">Spec</span>
      <span class="preview-cell preview-cell-type">Type</span>
      <span class="preview-cell preview-cell-item">Item</span>
      <span class="preview-cell preview-cell-status">Status</span>
      <span class="preview-cell preview-cell-delivery">Delivery</span>
      <span class="preview-cell preview-cell-backlog">Backlog</span>
    </div>`;
        const treeHtml = renderPreviewTreeNode(previewRoot, 0);
        const heading = SINGLE_SOURCE_MODE ? 'Specs browser' : `${section.label} — Specs`;
        const indexBody = `
    <section class="hero">
      <div class="eyebrow">Kinetiq Core</div>
      ${specsCrumbs}
      <h1>${escHtml(heading)}</h1>
      <p class="subhead">${specs.length} spec file${specs.length === 1 ? '' : 's'}${section.source ? ` from ${escHtml(section.source.label)}` : ' across all configured sources'}. Search by title, path, or item; filter by type.</p>
    </section>
    <section class="panel" id="specs-preview-root">
      ${filterBar}
      ${headerStrip}
      <div class="spec-tree spec-tree-preview">${treeHtml || '<p>No specs found.</p>'}</div>
    </section>
    ${PREVIEW_SCRIPT}
  `;
        const indexPath = join(OUTPUT_DIR, indexUrl);
        ensureDir(dirname(indexPath));
        writeFileSync(indexPath, pageShell(heading, sections, section.slug, 'browse', indexBody, indexUrl));
        searchIndex.push({
            title: heading,
            section: section.label,
            group: 'Specs',
            snippet: `Specs browser with ${specs.length} specs — search, filter by type, and jump to each spec.`,
            url: indexUrl,
        });
    }
    // Build an L1/L2 breakdown for each source-backed section: L1 = top-level
    // folders in the spec tree (e.g. engine, library); L2 = their direct child
    // folders (e.g. engine/features, engine/ops). Each L2 entry links into the
    // filterable browser with a ?q=<path> prefill.
    function buildRootBreakdown() {
        const sourceSections = sections.filter((s) => s.source);
        if (!sourceSections.length)
            return '';
        const columns = sourceSections
            .map((section) => {
            const specs = specsBySource.get(section.source.id) || [];
            if (!specs.length)
                return '';
            const tree = newTreeNode('');
            for (const spec of specs) {
                let segments = spec.relPath.split('/').filter(Boolean);
                if (segments[0] === 'specs')
                    segments = segments.slice(1);
                const folderSegments = segments.slice(0, -1);
                insertSpec(tree, folderSegments, spec);
            }
            const browserHref = routeFor(section.slug, 'browse');
            const link = (q, inner) => `<a class="breakdown-row" href="${browserHref}?q=${encodeURIComponent(q)}">${inner}</a>`;
            const l1Nodes = Array.from(tree.children.values()).sort((a, b) => a.name.localeCompare(b.name));
            const l1Blocks = l1Nodes.map((l1) => {
                const l1Count = countTreeFiles(l1);
                const l1Roll = rollupTreeNode(l1);
                const l1Bar = renderRollupBar(l1Roll);
                const l1Header = link(l1.name, `<span class="breakdown-name">${escHtml(l1.name)}</span>
           <span class="breakdown-count">${l1Count} spec${l1Count === 1 ? '' : 's'}</span>
           ${l1Bar}`);
                const l2Nodes = Array.from(l1.children.values()).sort((a, b) => a.name.localeCompare(b.name));
                const looseCount = l1.files.length;
                const l2Rows = l2Nodes
                    .map((l2) => {
                    const count = countTreeFiles(l2);
                    const bar = renderRollupBar(rollupTreeNode(l2));
                    return link(`${l1.name}/${l2.name}`, `<span class="breakdown-name breakdown-name-sub">${escHtml(l2.name)}</span>
               <span class="breakdown-count">${count} spec${count === 1 ? '' : 's'}</span>
               ${bar}`);
                })
                    .join('');
                const looseRow = looseCount && l2Nodes.length
                    ? `<div class="breakdown-row breakdown-row-note"><span class="breakdown-name breakdown-name-sub">(loose)</span><span class="breakdown-count">${looseCount} spec${looseCount === 1 ? '' : 's'} directly under ${escHtml(l1.name)}/</span></div>`
                    : '';
                return `
          <div class="breakdown-l1">
            ${l1Header}
            ${l2Rows}${looseRow}
          </div>`;
            }).join('');
            return `
        <div class="breakdown-column">
          <div class="breakdown-column-head">
            <h3>${escHtml(section.label)}</h3>
            <a class="breakdown-open" href="${browserHref}">Open Specs browser &rarr;</a>
          </div>
          ${l1Blocks}
        </div>`;
        })
            .filter(Boolean)
            .join('');
        return columns
            ? `<section class="panel"><h2>Specs by area</h2><div class="breakdown-grid">${columns}</div></section>`
            : '';
    }
    const rootBreakdown = buildRootBreakdown();
    const overallDelivery = snapshot.progress.delivery.all;
    const overallBacklog = snapshot.progress.backlog.all;
    const overallProgressPanel = `
  <section class="panel">
    <h2>Overall progress</h2>
    <div class="progress-group"><h3>Delivery <span class="progress-group-note">Subfeatures across all sources — see each spec page for detail</span></h3>${renderProgress(overallDelivery)}</div>
    <div class="progress-group"><h3>Backlog <span class="progress-group-note">Open questions and tracked items across all sources — see each spec page for detail</span></h3>${renderProgress(overallBacklog)}</div>
  </section>`;
    const rootSourceRows = snapshot.sources
        .map((source) => `
    <div class="source-row">
      <div>
        <strong>${escHtml(source.label)}</strong>
        <div class="source-meta">${escHtml(source.id)}</div>
        <div class="source-meta">${escHtml(source.configuredRoot)}</div>
      </div>
      <div>
        <div><span class="status-badge status-${statusTone(source.status)}">${escHtml(source.status)}</span></div>
        <div class="source-meta" style="margin-top:8px;">${source.trackedFiles} tracked files</div>
      </div>
    </div>`)
        .join('');
    const indexBody = `
  <section class="hero">
    <div class="eyebrow">Kinetiq Core</div>
    <h1>Roadmaps</h1>
    <p class="subhead">Living blueprints across the product. Overall progress summarises delivery and backlog; the breakdown lists top-level and second-level spec folders with a release-aware status bar.</p>
    <div class="meta">Snapshot generated ${escHtml(snapshot.generatedAt)} via ${escHtml(snapshot.generatedBy)}</div>
    ${PROGRESS_LEGEND_HTML}
    <div class="links">
      <a href="../index.html">Resources home</a>
      <a href="roadmaps.json">Snapshot JSON</a>
      <a href="search.html">Search</a>
    </div>
  </section>
  ${overallProgressPanel}
  ${rootBreakdown}
  <section class="panel">
    <h2>Sources</h2>
    <div class="source-list">${rootSourceRows || '<p>No sources recorded.</p>'}</div>
  </section>
`;
    writeFileSync(join(OUTPUT_DIR, 'index.html'), pageShell('Roadmaps', sections, 'root', 'index', indexBody, 'index.html'));
    const searchBody = `
  <section class="hero">
    <div class="eyebrow">Kinetiq Core</div>
    <h1>Search</h1>
    <p class="subhead">Search across combined portfolio views and repository-specific workstream sections.</p>
  </section>
  <section class="panel">
    <div class="search-page">
      <div class="search-page-bar">
        <input type="text" id="full-search-input" class="full-search-input" placeholder="Search roadmap content..." autofocus />
      </div>
      <div id="full-search-results" class="full-search-results"></div>
    </div>
  </section>
  <style>
    .search-page { max-width: 880px; }
    .full-search-input {
      width: 100%;
      padding: 14px 18px;
      border: 2px solid var(--line);
      border-radius: 12px;
      font-size: 17px;
      font-family: inherit;
      background: var(--paper);
      color: var(--ink);
      outline: none;
    }
    .full-search-input:focus { border-color: var(--secondary); }
    .search-page-bar { margin-bottom: 24px; }
    .search-result-card { padding: 16px 0; border-bottom: 1px solid var(--line); }
    .search-result-card:first-child { padding-top: 0; }
    .search-result-card a { text-decoration: none; color: inherit; display: block; }
    .search-result-card a:hover .search-card-title { color: var(--secondary); }
    .search-card-title { font-size: 17px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
    .search-card-breadcrumb { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    .search-card-snippet { font-size: 14px; color: var(--ink); line-height: 1.6; opacity: 0.85; }
    .search-card-snippet mark { background: rgba(201, 111, 59, 0.2); color: var(--ink); padding: 1px 2px; border-radius: 2px; }
    .search-no-results { color: var(--muted); font-size: 15px; padding: 24px 0; }
    .search-result-count { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.min.js"></script>
  <script>
  (function() {
    var input = document.getElementById('full-search-input');
    var resultsEl = document.getElementById('full-search-results');
    var searchData = null;
    var fuse = null;

    fetch('data/search-index.json')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        searchData = data;
        fuse = new Fuse(data, {
          keys: [{ name: 'title', weight: 3 }, { name: 'section', weight: 1 }, { name: 'group', weight: 1 }, { name: 'snippet', weight: 2 }],
          threshold: 0.3,
          ignoreLocation: true
        });
        var params = new URLSearchParams(location.search);
        var q = params.get('q');
        if (q) { input.value = q; runSearch(q); }
      });

    function searchFor(q) {
      if (!searchData) return [];
      var qLower = q.toLowerCase();
      var exact = searchData.filter(function(d) {
        return (d.title && d.title.toLowerCase().indexOf(qLower) !== -1)
          || (d.section && d.section.toLowerCase().indexOf(qLower) !== -1)
          || (d.group && d.group.toLowerCase().indexOf(qLower) !== -1)
          || (d.snippet && d.snippet.toLowerCase().indexOf(qLower) !== -1);
      }).map(function(d) { return { item: d }; });
      if (exact.length > 0) return exact;
      if (!fuse) return [];
      return fuse.search(q);
    }

    var timer;
    input.addEventListener('input', function() {
      clearTimeout(timer);
      timer = setTimeout(function() { runSearch(input.value.trim()); }, 200);
    });

    function runSearch(q) {
      if (!q || !searchData) { resultsEl.innerHTML = ''; return; }
      var results = searchFor(q).slice(0, 30);
      if (!results.length) {
        resultsEl.innerHTML = '<div class="search-no-results">No results for "' + esc(q) + '"</div>';
        return;
      }
      var html = '<div class="search-result-count">' + results.length + ' result' + (results.length > 1 ? 's' : '') + '</div>';
      results.forEach(function(r) {
        var it = r.item;
        var ctx = extractContext(it.snippet, q);
        html += '<div class="search-result-card"><a href="' + esc(it.url) + '">'
          + '<div class="search-card-title">' + esc(it.title) + '</div>'
          + '<div class="search-card-breadcrumb">' + esc(it.section) + (it.group ? ' / ' + esc(it.group) : '') + '</div>'
          + '<div class="search-card-snippet">' + ctx + '</div>'
          + '</a></div>';
      });
      resultsEl.innerHTML = html;
    }

    function extractContext(text, query) {
      if (!text) return '';
      var lower = text.toLowerCase();
      var qLower = query.toLowerCase();
      var idx = lower.indexOf(qLower);
      if (idx === -1) return esc(text.slice(0, 220)) + '...';
      var start = Math.max(0, idx - 80);
      var end = Math.min(text.length, idx + query.length + 120);
      var slice = text.slice(start, end);
      var matchStart = idx - start;
      var before = esc(slice.slice(0, matchStart));
      var match = esc(slice.slice(matchStart, matchStart + query.length));
      var after = esc(slice.slice(matchStart + query.length));
      return (start > 0 ? '...' : '') + before + '<mark>' + match + '</mark>' + after + (end < text.length ? '...' : '');
    }

    function esc(s) {
      var d = document.createElement('span');
      d.textContent = s || '';
      return d.innerHTML;
    }
  })();
  </script>
`;
    writeFileSync(join(OUTPUT_DIR, 'search.html'), pageShell('Search', sections, 'root', 'search', searchBody, 'search.html'));
    writeFileSync(join(OUTPUT_DIR, 'data', 'search-index.json'), JSON.stringify(searchIndex, null, 2));
    console.warn(`Generated roadmaps site at ${OUTPUT_DIR}`);
}
