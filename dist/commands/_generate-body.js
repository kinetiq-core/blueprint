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
    <span class="progress-legend-item"><span class="progress-legend-swatch shipped"></span>Landed</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch beta"></span>Validated</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch alpha"></span>Active &middot; review</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch planned"></span>Queued</span>
    <span class="progress-legend-item"><span class="progress-legend-swatch parked"></span>Parked (excluded from %)</span>
  </div>`;
    function renderProgress(count, opts = {}) {
        if (!count || count.total === 0)
            return '';
        const segments = [
            count.shipped > 0 ? `<span class="progress-seg shipped" style="width:${count.pct_shipped}%" title="${count.shipped} landed"></span>` : '',
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
        meta.push(`<span class="progress-count"><b>${count.shipped}</b> landed</span>`);
        if (count.beta)
            meta.push(`<span class="progress-count"><b>${count.beta}</b> validated</span>`);
        if (count.alpha)
            meta.push(`<span class="progress-count"><b>${count.alpha}</b> active</span>`);
        if (count.planned)
            meta.push(`<span class="progress-count"><b>${count.planned}</b> queued</span>`);
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
        if (pageKey === 'table')
            return `${sectionPrefix(sectionSlug)}table/index.html`;
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
            `<a href="index.html" class="${activeSectionSlug === 'root' ? 'active' : ''}">Dashboard</a>`,
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
    <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch theme">Signal</button>
  </div>`;
    }
    function buildSidebar(sections, activeSectionSlug, activePageKey) {
        return `
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="../index.html" class="sidebar-back">Resources</a>
      <div class="sidebar-title">Product Truth</div>
    </div>
    <div class="sidebar-nav">
      <div class="nav-section">
        <div class="nav-section-title">Overview</div>
        <a href="index.html" class="sidebar-link ${activeSectionSlug === 'root' && activePageKey === 'index' ? 'active' : ''}">Dashboard</a>
        <a href="search.html" class="sidebar-link ${activeSectionSlug === 'root' && activePageKey === 'search' ? 'active' : ''}">Search</a>
      </div>
      ${sections
            .map((section) => `
      <div class="nav-section">
        <div class="nav-section-title">${escHtml(section.label)}</div>
        ${section.pages
            .filter((page) => page.key !== 'schema')
            .map((page) => `<a href="${page.href}" class="sidebar-link ${section.slug === activeSectionSlug && page.key === activePageKey ? 'active' : ''}">${escHtml(page.label)}</a>`)
            .join('')}
      </div>`)
            .join('')}
      <div class="nav-section">
        <div class="nav-section-title">Reference</div>
        ${sections
            .flatMap((section) => section.pages.filter((page) => page.key === 'schema').map((page) => ({ section, page })))
            .map(({ section, page }) => `<a href="${page.href}" class="sidebar-link ${section.slug === activeSectionSlug && page.key === activePageKey ? 'active' : ''}">${escHtml(section.label === 'Specs' ? page.label : `${section.label} ${page.label}`)}</a>`)
            .join('')}
      </div>
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
<script>
(function() {
  try {
    var theme = localStorage.getItem('productTruthTheme') || 'classic';
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = 'classic';
  }
})();
</script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  :root {
    --bg: #F4F6F7;
    --surface: #FFFFFF;
    --paper: #FFFFFF;
    --panel-bg: #FFFFFF;
    --panel-subtle: #F7F9FA;
    --tile-bg: #F7F9FA;
    --content-card-bg: #FFFFFF;
    --content-card-hover-bg: #FAFCFC;
    --table-header-bg: #F0F4F6;
    --table-header-text: #4E606B;
    --control-bg: #F7F9FA;
    --hover-bg: rgba(24, 33, 38, 0.05);
    --ink: #152028;
    --muted: #5E6A72;
    --accent: #B75F32;
    --secondary: #2F7C7A;
    --primary: #315C8A;
    --critical: #9F3D2E;
    --success: #2F7C7A;
    --warning: #B75F32;
    --info: #315C8A;
    --progress-beta: #6FA9A1;
    --progress-planned: #BFC9CD;
    --code-bg: #182126;
    --code-fg: #F7F9FA;
    --focus: #315C8A;
    --border: #D7E0E3;
    --line: #D7E0E3;
    --nav-bg: #F7F9FA;
    --nav-text: #5E6A72;
    --nav-active: #182126;
    --nav-border: #D7E0E3;
    --nav-hover-bg: rgba(24, 33, 38, 0.05);
    --sidebar-bg: var(--nav-bg);
    --sidebar-text: var(--nav-text);
    --sidebar-active: var(--nav-active);
    --input-bg: #FFFFFF;
    --input-placeholder: #8A9BA3;
    --shadow-panel: none;
    --topbar-height: 52px;
  }

  html[data-theme="signal"] {
    --bg: #EDF5FA;
    --surface: #FFFFFF;
    --paper: #FFFFFF;
    --panel-bg: #FFFFFF;
    --panel-subtle: #ECF6FA;
    --tile-bg: #F0F8FF;
    --content-card-bg: #FFFFFF;
    --content-card-hover-bg: #F6FBFF;
    --table-header-bg: #E7F1F8;
    --table-header-text: #334A5C;
    --control-bg: #ECF6FA;
    --hover-bg: rgba(36, 107, 254, 0.08);
    --ink: #10202B;
    --muted: #607381;
    --accent: #F59E0B;
    --secondary: #00A99D;
    --primary: #246BFE;
    --critical: #E5484D;
    --success: #16A34A;
    --warning: #F59E0B;
    --info: #7C3AED;
    --progress-beta: #38BDF8;
    --progress-planned: #A9B7C4;
    --code-bg: #0B1724;
    --code-fg: #EAF7FF;
    --focus: #246BFE;
    --border: #C9DDEA;
    --line: #C9DDEA;
    --nav-bg: #0F1F2E;
    --nav-text: #B9C7D3;
    --nav-active: #FFFFFF;
    --nav-border: rgba(255,255,255,0.12);
    --nav-hover-bg: rgba(255,255,255,0.08);
    --sidebar-bg: #102235;
    --sidebar-text: #B9C7D3;
    --sidebar-active: #FFFFFF;
    --input-bg: #FFFFFF;
    --input-placeholder: #7890A0;
    --shadow-panel: 0 18px 44px rgba(16, 32, 43, 0.08);
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    background: var(--bg);
    color: var(--ink);
    line-height: 1.7;
    display: flex;
    min-height: 100vh;
    padding-top: var(--topbar-height);
  }

  .topbar {
    position: fixed; top: 0; left: 0; right: 0;
    min-height: 52px;
    background: var(--nav-bg); z-index: 25;
    display: flex; align-items: stretch; flex-wrap: wrap;
    border-bottom: 1px solid var(--nav-border);
  }
  .topbar-breadcrumb { display: none; }
  .topbar-brand {
    width: 260px; flex-shrink: 0;
    display: flex; align-items: center; gap: 10px;
    padding: 0 20px 0 24px;
    border-right: 1px solid var(--nav-border);
  }
  .topbar-menu-btn {
    display: none; background: none; border: none; color: var(--nav-active);
    font-size: 17px; cursor: pointer; padding: 4px 6px; line-height: 1;
    border-radius: 6px; flex-shrink: 0;
  }
  .topbar-menu-btn:hover { background: var(--nav-hover-bg); }
  .topbar-wordmark {
    font-size: 13px; font-weight: 800; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--nav-active); text-decoration: none; white-space: nowrap;
  }
  .topbar-nav {
    flex: 1; display: flex; align-items: center; padding: 0 12px; gap: 2px;
  }
  .topbar-nav a {
    padding: 5px 11px; font-size: 13px; font-weight: 600;
    color: var(--nav-text); text-decoration: none;
    border-radius: 6px; transition: all 0.1s; white-space: nowrap;
  }
  .topbar-nav a:hover { color: var(--nav-active); background: var(--nav-hover-bg); }
  .topbar-nav a.active { color: var(--nav-active); }
  .topbar-search {
    position: relative; display: flex; align-items: center;
    padding: 0 20px 0 12px; gap: 8px;
    border-left: 1px solid var(--nav-border);
  }
  .topbar-search .search-input {
    width: 340px; padding: 8px 14px;
    border: 1px solid var(--line); border-radius: 8px;
    font-size: 13.5px; font-family: inherit; background: var(--input-bg);
    color: var(--ink); outline: none; box-sizing: border-box;
  }
  .topbar-search .search-input::placeholder { color: var(--input-placeholder); }
  .topbar-search .search-input:focus { border-color: var(--focus); box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 14%, transparent); }
  .search-kbd {
    font-size: 11px; font-weight: 600; color: var(--muted);
    background: var(--panel-subtle); border: 1px solid var(--line);
    border-radius: 4px; padding: 2px 6px; white-space: nowrap;
    pointer-events: none; flex-shrink: 0;
  }
  .theme-toggle {
    align-self: center;
    margin-right: 16px;
    border: 1px solid var(--nav-border);
    background: color-mix(in srgb, var(--primary) 18%, transparent);
    color: var(--nav-active);
    border-radius: 7px;
    padding: 7px 10px;
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .theme-toggle:hover { background: color-mix(in srgb, var(--primary) 30%, transparent); }
  .topbar-search .search-results {
    position: absolute; top: calc(100% + 4px); right: 20px; left: 12px; z-index: 100;
    background: var(--panel-bg); border: 1px solid var(--line);
    border-radius: 8px; max-height: 360px; overflow-y: auto;
    box-shadow: 0 12px 32px rgba(24,33,38,0.12); display: none;
  }
  .topbar-search .search-results.active { display: block; }
  .topbar-search .search-result-item {
    display: block; padding: 11px 12px; text-decoration: none;
    border-bottom: 1px solid var(--line); color: var(--ink);
  }
  .topbar-search .search-result-item:last-child { border-bottom: 0; }
  .topbar-search .search-result-item.highlighted,
  .topbar-search .search-result-item:hover { background: var(--panel-subtle); }
  .search-result-name {
    display: block; color: var(--ink); font-size: 13px; font-weight: 700;
  }
  .search-result-section {
    display: block; margin-top: 3px; color: var(--muted); font-size: 11px;
  }
  .layout {
    display: block;
    width: 100%;
    min-height: calc(100vh - var(--topbar-height));
  }
  .sidebar {
    width: 260px;
    background: var(--sidebar-bg);
    border-right: 1px solid var(--nav-border);
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
    border-bottom: 1px solid var(--nav-border);
    background: var(--sidebar-bg);
  }
  .nav-section { margin-bottom: 8px; }
  .nav-section-title {
    padding: 12px 24px 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--secondary);
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
    background: var(--nav-hover-bg);
  }
  .sidebar-link.active {
    color: var(--sidebar-active);
    font-weight: 600;
    background: var(--nav-hover-bg);
    border-left-color: var(--accent);
  }
  .main {
    width: calc(100% - 260px);
    margin-left: 260px;
    padding: calc(var(--topbar-height) + 22px) 0 64px;
  }
  .shell {
    width: 100%;
    max-width: 1480px;
    margin: 0 auto;
    padding: 0 28px;
  }
  .hero, .panel {
    background: var(--panel-bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow-panel);
  }
  .hero { padding: 30px 32px 26px; }
  .panel { padding: 22px; margin-top: 16px; }
  .eyebrow {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h1 {
    margin-top: 12px;
    font-size: 38px;
    line-height: 1.08;
    letter-spacing: 0;
  }
  .subhead {
    margin-top: 12px;
    max-width: 900px;
    font-size: 16px;
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
    background: var(--panel-bg);
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
  .insight-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(160px, 1fr));
    gap: 12px;
    margin-top: 22px;
  }
  .insight-card {
    display: block;
    text-decoration: none;
    color: inherit;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-bg);
    padding: 16px;
  }
  .insight-card:hover { border-color: var(--secondary); background: var(--panel-subtle); }
  .dashboard-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
    gap: 16px;
    margin-top: 16px;
  }
  .dashboard-stack {
    display: grid;
    gap: 16px;
    align-content: start;
  }
  .dashboard-panel {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-bg);
    padding: 16px;
  }
  .dashboard-panel h2, .dashboard-panel h3 {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink);
    margin: 0 0 10px;
  }
  .dashboard-note {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .risk-list {
    display: grid;
    gap: 8px;
  }
  .risk-item {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
  }
  .risk-item:last-child { border-bottom: 0; }
  .risk-score {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 24px;
    border-radius: 5px;
    background: rgba(159, 61, 46, 0.10);
    color: var(--critical);
    font-size: 12px;
    font-weight: 800;
  }
  .risk-title {
    min-width: 0;
  }
  .risk-title a {
    color: var(--ink);
    text-decoration: none;
    font-size: 13px;
    font-weight: 700;
  }
  .risk-title a:hover { color: var(--secondary); }
  .risk-meta {
    color: var(--muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .signal-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(120px, 1fr));
    gap: 10px;
  }
  .signal-tile {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px;
    background: var(--content-card-bg);
  }
  .signal-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .signal-value {
    margin-top: 7px;
    color: var(--ink);
    font-size: 22px;
    line-height: 1;
    font-weight: 850;
    font-variant-numeric: tabular-nums;
  }
  .insight-label {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .insight-value {
    margin-top: 10px;
    font-size: 30px;
    line-height: 1;
    font-weight: 800;
    color: var(--ink);
  }
  .insight-note {
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
    line-height: 1.45;
  }
  .lens-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
    gap: 20px;
    margin-top: 20px;
  }
  .lens-stack { display: grid; gap: 14px; min-width: 0; }
  .release-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .release-grid .lens-table { table-layout: fixed; }
  .release-grid .lens-table th:first-child,
  .release-grid .lens-table td:first-child {
    overflow-wrap: anywhere;
  }
  .release-grid .lens-table th:last-child,
  .release-grid .lens-table td:last-child {
    width: 70px;
    text-align: right;
  }
  .lens-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .lens-table th {
    text-align: left;
    padding: 9px 10px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--table-header-text);
    border-bottom: 1px solid var(--line);
    background: var(--table-header-bg);
  }
  .lens-table td {
    padding: 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: middle;
  }
  .lens-table a { color: var(--ink); text-decoration: none; font-weight: 650; }
  .lens-table a:hover { color: var(--secondary); }
  .lens-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .lens-muted { color: var(--muted); font-size: 12px; }
  .lens-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--control-bg);
    margin: 14px 0;
  }
  .lens-search {
    flex: 1 1 260px;
    min-width: 220px;
    padding: 8px 11px;
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    background: var(--input-bg);
    border: 1px solid var(--line);
    border-radius: 6px;
    outline: none;
  }
  .lens-search:focus {
    border-color: var(--focus);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--focus) 14%, transparent);
  }
  .lens-count {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
  }
  .lens-count strong {
    color: var(--ink);
  }
  .maturity-strip {
    display: grid;
    grid-template-columns: repeat(11, minmax(40px, 1fr));
    gap: 6px;
    margin-top: 16px;
  }
  .maturity-cell {
    min-height: 58px;
    border-radius: 7px;
    border: 1px solid var(--line);
    background: #fff;
    padding: 8px;
  }
  .maturity-cell-value { font-size: 20px; line-height: 1; font-weight: 800; color: var(--ink); }
  .maturity-cell-label {
    margin-top: 7px;
    font-size: 9px;
    line-height: 1.2;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .maturity-cell-warn { border-color: rgba(201, 111, 59, 0.42); background: rgba(201, 111, 59, 0.06); }
  .area-matrix {
    display: grid;
    gap: 8px;
    margin-top: 14px;
  }
  .area-row {
    display: grid;
    grid-template-columns: 190px repeat(11, minmax(28px, 1fr));
    gap: 6px;
    align-items: center;
  }
  .area-row.area-header {
    align-items: end;
    margin-bottom: 2px;
  }
  .area-heading {
    font-size: 10px;
    color: var(--muted);
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .area-col-label {
    min-height: 28px;
    display: flex;
    align-items: end;
    justify-content: center;
    color: var(--muted);
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    text-align: center;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  .area-name { font-size: 13px; font-weight: 700; color: var(--ink); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .area-dot {
    min-height: 28px;
    border-radius: 5px;
    border: 1px solid var(--line);
    background: #fff;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted);
  }
  .area-dot.has-count { color: var(--ink); background: rgba(47, 124, 122, 0.08); border-color: rgba(47, 124, 122, 0.22); }
  .area-dot.warn { background: rgba(201, 111, 59, 0.08); border-color: rgba(201, 111, 59, 0.28); }
  .kanban-board {
    display: grid;
    grid-template-columns: repeat(6, minmax(170px, 1fr));
    gap: 12px;
    margin-top: 18px;
    align-items: start;
  }
  .kanban-column {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #fff;
    min-width: 0;
  }
  .kanban-heading {
    padding: 12px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .kanban-heading h3 {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .kanban-count {
    min-width: 24px;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(24, 33, 38, 0.06);
    color: var(--muted);
    text-align: center;
    font-size: 11px;
    font-weight: 800;
  }
  .kanban-cards {
    display: grid;
    gap: 8px;
    padding: 10px;
  }
  .kanban-card {
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 10px;
    background: var(--content-card-bg);
  }
  .kanban-card:hover { border-color: var(--primary); background: var(--content-card-hover-bg); }
  .kanban-card a {
    color: var(--ink);
    text-decoration: none;
    font-size: 12px;
    font-weight: 750;
    line-height: 1.3;
  }
  .kanban-card a:hover { color: var(--secondary); }
  .kanban-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 10px;
  }
  .kanban-chip {
    display: inline-flex;
    border-radius: 4px;
    background: #fff;
    border: 1px solid var(--line);
    padding: 2px 5px;
    max-width: 100%;
  }
  .kanban-more {
    color: var(--muted);
    font-size: 11px;
    padding: 2px 0 4px;
  }
  .schema-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(260px, 1fr));
    gap: 16px;
    margin-top: 16px;
  }
  .schema-box {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #fff;
    padding: 14px;
  }
  .schema-box h3 {
    margin: 0 0 10px;
    font-size: 13px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .schema-field {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--line);
    font-size: 12px;
  }
  .schema-field:first-of-type { border-top: 0; }
  .schema-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--ink);
    overflow-wrap: anywhere;
  }
  .schema-desc { color: var(--muted); line-height: 1.45; }
  .governance-list {
    display: grid;
    gap: 10px;
    margin-top: 14px;
  }
  .governance-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .governance-row:last-child { border-bottom: 0; }
  .governance-level {
    width: 30px;
    height: 26px;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(201, 111, 59, 0.12);
    color: var(--accent);
    font-size: 11px;
    font-weight: 850;
  }
  .governance-title { font-size: 13px; font-weight: 750; color: var(--ink); }
  .governance-note { color: var(--muted); font-size: 12px; line-height: 1.35; }
  .spec-record {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
    gap: 16px;
    margin-top: 16px;
  }
  .spec-record-main, .spec-record-side {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #fff;
    padding: 16px;
  }
  .spec-record-main h2, .spec-record-side h2 {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink);
    margin-bottom: 12px;
  }
  .spec-record-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(120px, 1fr));
    gap: 10px;
  }
  .spec-record-field {
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 10px;
    background: var(--content-card-bg);
    min-width: 0;
  }
  .spec-record-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .spec-record-value {
    margin-top: 6px;
    color: var(--ink);
    font-size: 13px;
    font-weight: 750;
    overflow-wrap: anywhere;
  }
  .spec-record-path {
    margin-top: 12px;
    color: var(--muted);
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere;
  }
  .work-list {
    display: grid;
    gap: 10px;
    margin-top: 16px;
  }
  .work-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 100px 110px 110px;
    gap: 14px;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }
  .work-row:last-child { border-bottom: 0; }
  .work-title a { color: var(--ink); text-decoration: none; font-weight: 700; }
  .work-title a:hover { color: var(--secondary); }
  .work-path { margin-top: 3px; color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .metric-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 800;
    background: rgba(24, 33, 38, 0.06);
    color: var(--ink);
  }
  .metric-pill.warn { background: rgba(201, 111, 59, 0.14); color: var(--accent); }
  .metric-pill.good { background: rgba(47, 124, 122, 0.12); color: var(--secondary); }
  @media (max-width: 1180px) {
    .insight-grid { grid-template-columns: repeat(2, minmax(160px, 1fr)); }
    .dashboard-grid, .spec-record { grid-template-columns: 1fr; }
    .lens-grid { grid-template-columns: 1fr; }
    .kanban-board { grid-template-columns: repeat(3, minmax(180px, 1fr)); }
  }
  @media (max-width: 760px) {
    .insight-grid { grid-template-columns: 1fr; }
    .maturity-strip { grid-template-columns: repeat(3, minmax(70px, 1fr)); }
    .area-row { grid-template-columns: 1fr repeat(4, minmax(28px, 1fr)); }
    .area-row .area-dot:nth-of-type(n+5), .area-row .area-col-label:nth-of-type(n+5) { display: none; }
    .kanban-board { grid-template-columns: 1fr; }
    .schema-grid { grid-template-columns: 1fr; }
    .signal-grid, .spec-record-grid { grid-template-columns: 1fr; }
    .governance-row, .risk-item { grid-template-columns: 1fr; }
    .schema-field { grid-template-columns: 1fr; gap: 4px; }
    .work-row { grid-template-columns: 1fr 70px; }
    .work-row > :nth-child(3), .work-row > :nth-child(4) { display: none; }
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
    background: var(--panel-subtle);
    overflow: hidden;
  }
  .progress-compact .progress-bar {
    height: 6px;
  }
  .progress-seg { display: block; height: 100%; }
  .progress-seg.shipped { background: var(--secondary); }
  .progress-seg.beta { background: var(--progress-beta); }
  .progress-seg.alpha { background: var(--accent); }
  .progress-seg.planned { background: var(--progress-planned); }
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
  .progress-legend-swatch.beta { background: var(--progress-beta); }
  .progress-legend-swatch.alpha { background: var(--accent); }
  .progress-legend-swatch.planned { background: var(--progress-planned); }
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
  .preview-toggle-all {
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
  .preview-toggle-all:hover { color: var(--ink); border-color: var(--ink); }
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
  .preview-cell-maturity { width: 120px; }
  .preview-cell-status { width: 130px; }
  .preview-cell-delivery { width: 120px; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .preview-cell-backlog { width: 130px; }
  .rollup-bar-tight { width: 70px; }

  /* Flat-table variant (Specs (table) page) */
  .spec-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .spec-table thead th {
    text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--table-header-text);
    border-bottom: 1px solid var(--line); white-space: nowrap;
    background: var(--table-header-bg);
  }
  .spec-table tbody td {
    padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: middle;
  }
  .spec-table tbody tr:hover { background: rgba(47, 124, 122, 0.04); }
  .spec-table .spec-table-path {
    color: var(--muted); font-size: 11px; white-space: nowrap;
    max-width: 240px; overflow: hidden; text-overflow: ellipsis;
  }
  .spec-table .spec-table-spec a {
    color: var(--ink); text-decoration: none; font-weight: 600;
  }
  .spec-table .spec-table-spec a:hover { color: var(--secondary); }
  .spec-table .spec-table-file {
    display: block; color: var(--muted); font-size: 11px; margin-top: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .spec-table .spec-table-item {
    color: var(--ink); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .spec-table .spec-table-delivery { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .spec-table tr.filtered-out { display: none; }
  @media (max-width: 960px) {
    .spec-table .spec-table-item, .spec-table .spec-table-path { display: none; }
  }
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
  .maturity-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 110px;
    padding: 2px 7px;
    border-radius: 5px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    background: rgba(24, 33, 38, 0.06);
    color: var(--muted);
    white-space: nowrap;
  }
  .maturity-badge::before {
    content: attr(data-level);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 14px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.72);
    color: inherit;
    font-size: 9px;
  }
  .maturity-rework-needed { background: rgba(201, 111, 59, 0.16); color: var(--accent); }
  .maturity-buildable, .maturity-implemented { background: rgba(47, 124, 122, 0.12); color: var(--secondary); }
  .maturity-released, .maturity-validated, .maturity-stable, .maturity-proven { background: rgba(47, 124, 122, 0.18); color: #236967; }
  .maturity-unassessed { background: rgba(93, 105, 112, 0.10); color: var(--muted); }
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
    background: var(--panel-subtle);
    overflow: hidden;
    margin-left: auto;
  }
  .preview-folder .spec-tree-folder-count { margin-left: 10px; }
  .rollup-seg { display: block; height: 100%; }
  .rollup-seg.shipped { background: var(--secondary); }
  .rollup-seg.beta { background: var(--progress-beta); }
  .rollup-seg.alpha { background: var(--accent); }
  .rollup-seg.planned { background: var(--progress-planned); }
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
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-bg);
    box-shadow: var(--shadow-panel);
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
    .theme-toggle {
      margin-right: 12px;
      padding: 7px 9px;
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
      border-bottom: 1px solid var(--nav-border);
      padding: 14px 18px;
    }
    .topbar-nav { padding: 10px 12px 12px; }
    .topbar-search {
      border-top: 1px solid var(--nav-border);
      padding: 12px;
    }
    .theme-toggle {
      margin: 0 12px 12px;
      width: calc(100% - 24px);
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
      border-right: 1px solid var(--nav-border);
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
      border-bottom: 1px solid var(--nav-border);
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
    var themeBtn = topbar.querySelector('[data-theme-toggle]');
    function currentTheme() {
      return document.documentElement.dataset.theme === 'signal' ? 'signal' : 'classic';
    }
    function updateThemeButton() {
      if (!themeBtn) return;
      themeBtn.textContent = currentTheme() === 'signal' ? 'Classic' : 'Signal';
      themeBtn.setAttribute('aria-label', 'Switch to ' + themeBtn.textContent + ' theme');
    }
    updateThemeButton();
    if (themeBtn) {
      themeBtn.addEventListener('click', function() {
        var next = currentTheme() === 'signal' ? 'classic' : 'signal';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('productTruthTheme', next); } catch (e) {}
        updateThemeButton();
      });
    }
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
    const specByPath = new Map();
    for (const spec of allSpecs) {
        specPathToUrl.set(spec.specPath, spec.url);
        specPathToTitle.set(spec.specPath, spec.title);
        specByPath.set(spec.specPath, spec);
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
            if (v === 'landed' || v === 'done' || v === 'implemented' || v === 'shipped')
                return 'shipped';
            if (v === 'active' || v === 'review' || v === 'in review' || v === 'in progress' || v === 'alpha' || v === 'started')
                return 'alpha';
            if (v === 'queued' || v === 'planned' || v === 'open')
                return 'planned';
            if (v === 'blocked')
                return 'alpha';
            if (v === 'deferred' || v === 'parked')
                return 'parked';
            return null;
        };
        const getStats = (key) => {
            let s = specStatsByPath.get(key);
            if (!s) {
                s = { bucket: null, landed: 0, outstanding: 0, active: 0, blocked: 0, parked: 0, total: 0, targets: new Set(), delivered: new Set() };
                specStatsByPath.set(key, s);
            }
            return s;
        };
        const normalizeVersion = (v) => v.replace(/\s*\([^)]*\)\s*$/, '').trim();
        for (const row of snapshot.tables.subfeatures?.rows || []) {
            const bucket = subfeatureStatusToBucket(String(row.Status || ''));
            const stats = getStats(row.Spec);
            stats.total += 1;
            const workState = String(row.Status || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
            if (bucket === 'shipped')
                stats.landed += 1;
            else if (bucket === 'alpha' || bucket === 'beta' || bucket === 'planned')
                stats.outstanding += 1;
            else if (bucket === 'parked')
                stats.parked += 1;
            if (workState === 'active' || workState === 'review' || workState === 'in review' || workState === 'in progress' || workState === 'started' || workState === 'alpha')
                stats.active += 1;
            if (workState === 'blocked')
                stats.blocked += 1;
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
            if (v === 'active' || v === 'blocked' || v === 'in progress' || v === 'started' || v === 'drafted')
                return 'openPressure';
            if (v === 'open' || v === 'triaged' || v === 'planned')
                return 'openPressure';
            if (v === 'parked' || v === 'deferred')
                return 'parked';
            return null;
        };
        for (const row of snapshot.tables.backlog?.rows || []) {
            let s = specBacklogStatsByPath.get(row.Spec);
            if (!s) {
                s = { resolved: 0, openPressure: 0, active: 0, blocked: 0, parked: 0, total: 0 };
                specBacklogStatsByPath.set(row.Spec, s);
            }
            s.total += 1;
            const status = String(row.Status || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
            const b = classifyBacklog(String(row.Status || ''));
            if (b)
                s[b] += 1;
            if (status === 'active' || status === 'in progress' || status === 'started' || status === 'drafted')
                s.active += 1;
            if (status === 'blocked')
                s.blocked += 1;
        }
    }
    function renderSpecBacklogCell(stats) {
        if (!stats || stats.total === 0)
            return '<span class="preview-empty">—</span>';
        const seg = (n, cls) => n > 0 ? `<span class="rollup-seg ${cls}" style="width:${(n / stats.total) * 100}%"></span>` : '';
        const bar = `<span class="rollup-bar rollup-bar-tight">${seg(stats.resolved, 'shipped')}${seg(stats.openPressure, 'planned')}</span>`;
        const unresolved = stats.openPressure;
        const title = `${unresolved} open pressure · ${stats.resolved} resolved${stats.parked ? ` · ${stats.parked} parked` : ''}`;
        return `<span class="spec-status-cell" title="${escAttr(title)}">${bar}<span class="spec-status-count">${unresolved}/${stats.total}</span></span>`;
    }
    function renderSpecStatusCell(stats) {
        if (!stats || stats.total === 0)
            return '<span class="preview-empty">—</span>';
        const seg = (n, cls) => n > 0 ? `<span class="rollup-seg ${cls}" style="width:${(n / stats.total) * 100}%"></span>` : '';
        const bar = `<span class="rollup-bar rollup-bar-tight">${seg(stats.landed, 'shipped')}${seg(stats.outstanding, 'planned')}</span>`;
        const title = `${stats.outstanding} outstanding · ${stats.landed} landed${stats.parked ? ` · ${stats.parked} parked` : ''}`;
        return `<span class="spec-status-cell" title="${escAttr(title)}">${bar}<span class="spec-status-count">${stats.outstanding}/${stats.total}</span></span>`;
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
    function renderSpecRecordHeader(spec) {
        const row = extractPreviewRow(spec.frontmatter);
        const stats = specStatsByPath.get(spec.specPath);
        const backlog = specBacklogStatsByPath.get(spec.specPath);
        const area = topAreaForSpec(spec);
        const field = (label, value) => `<div class="spec-record-field"><div class="spec-record-label">${escHtml(label)}</div><div class="spec-record-value">${value || '<span class="preview-empty">—</span>'}</div></div>`;
        const textField = (label, value) => field(label, value ? escHtml(value) : '');
        const workValue = stats ? `${stats.outstanding}/${stats.total} outstanding` : '';
        const pressureValue = backlog ? `${backlog.openPressure}/${backlog.total} open` : '';
        const releaseValue = stats ? renderSpecDeliveryCell(stats) : '';
        const schemaValue = spec.frontmatter.spec_schema || 'missing';
        const governance = [
            !spec.frontmatter.maturity && !spec.frontmatter.spec_maturity ? 'Maturity unassessed' : '',
            !spec.frontmatter.spec_schema ? 'Missing spec_schema' : '',
            !stats?.total && !backlog?.total ? 'No tracked work/backlog rows' : '',
            backlog?.blocked ? `${backlog.blocked} blocked backlog row${backlog.blocked === 1 ? '' : 's'}` : '',
            stats?.blocked ? `${stats.blocked} blocked work row${stats.blocked === 1 ? '' : 's'}` : '',
        ].filter(Boolean);
        return `<section class="spec-record">
    <div class="spec-record-main">
      <h2>Spec Record</h2>
      <div class="spec-record-grid">
        ${field('Maturity', renderSpecMaturityCell(spec))}
        ${textField('Area', area)}
        ${textField('Type', row.type || 'unspecified')}
        ${textField('Schema', schemaValue)}
        ${textField('Group', row.group)}
        ${textField('Item', row.item)}
        ${textField('Known Work', workValue)}
        ${field('Release', releaseValue)}
      </div>
      <div class="spec-record-path">${escHtml(spec.specPath)}</div>
    </div>
    <div class="spec-record-side">
      <h2>Operational Health</h2>
      <div class="schema-field"><div class="schema-key">Known work</div><div class="schema-desc">${renderSpecStatusCell(stats)}</div></div>
      <div class="schema-field"><div class="schema-key">Backlog pressure</div><div class="schema-desc">${renderSpecBacklogCell(backlog)}</div></div>
      <div class="schema-field"><div class="schema-key">Signals</div><div class="schema-desc">${governance.length ? escHtml(governance.join(' · ')) : 'No governance warnings in this record.'}</div></div>
    </div>
  </section>`;
    }
    const MATURITY_LEVELS = {
        unassessed: { label: 'Unassessed', level: '0', slug: 'unassessed' },
        sketch: { label: 'Sketch', level: '1', slug: 'sketch' },
        draft: { label: 'Draft', level: '2', slug: 'draft' },
        specified: { label: 'Specified', level: '3', slug: 'specified' },
        buildable: { label: 'Buildable', level: '4', slug: 'buildable' },
        implemented: { label: 'Implemented', level: '5', slug: 'implemented' },
        released: { label: 'Released', level: '6', slug: 'released' },
        validated: { label: 'Validated', level: '7', slug: 'validated' },
        stable: { label: 'Stable', level: '8', slug: 'stable' },
        proven: { label: 'Proven', level: '9', slug: 'proven' },
        'rework needed': { label: 'Rework Needed', level: 'R', slug: 'rework-needed' },
        rework: { label: 'Rework Needed', level: 'R', slug: 'rework-needed' },
    };
    function maturityForSpec(spec) {
        const raw = (spec.frontmatter.maturity || spec.frontmatter.spec_maturity || '').trim();
        const key = raw.toLowerCase();
        return MATURITY_LEVELS[key] || (raw ? { label: raw, level: '?', slug: raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom' } : MATURITY_LEVELS.unassessed);
    }
    function renderSpecMaturityCell(spec) {
        const m = maturityForSpec(spec);
        return `<span class="maturity-badge maturity-${escAttr(m.slug)}" data-level="${escAttr(m.level)}" title="Maturity: ${escAttr(m.label)}">${escHtml(m.label)}</span>`;
    }
    const MATURITY_ORDER = ['Unassessed', 'Sketch', 'Draft', 'Specified', 'Buildable', 'Implemented', 'Released', 'Validated', 'Stable', 'Proven', 'Rework Needed'];
    function maturityIndex(label) {
        const idx = MATURITY_ORDER.indexOf(label);
        return idx === -1 ? 99 : idx;
    }
    function topAreaForSpec(spec) {
        let segments = spec.relPath.split('/').filter(Boolean);
        if (segments[0] === 'specs')
            segments = segments.slice(1);
        if (segments[0] === 'engine' && segments[1])
            return `engine/${segments[1]}`;
        return segments[0] || '(root)';
    }
    function folderForSpec(spec) {
        let segments = spec.relPath.split('/').filter(Boolean);
        if (segments[0] === 'specs')
            segments = segments.slice(1);
        return segments.slice(0, -1).join('/');
    }
    function buildInsightSpecs(specs) {
        return specs.map((spec) => ({
            spec,
            row: extractPreviewRow(spec.frontmatter),
            maturity: maturityForSpec(spec),
            work: specStatsByPath.get(spec.specPath),
            backlog: specBacklogStatsByPath.get(spec.specPath),
            area: topAreaForSpec(spec),
            folder: folderForSpec(spec),
        }));
    }
    function sumOutstanding(items) {
        return items.reduce((n, item) => n + (item.work?.outstanding || 0), 0);
    }
    function sumLanded(items) {
        return items.reduce((n, item) => n + (item.work?.landed || 0), 0);
    }
    function sumBacklogPressure(items) {
        return items.reduce((n, item) => n + (item.backlog?.openPressure || 0), 0);
    }
    function attrValue(value) {
        return value || '—';
    }
    function targetsForItem(item) {
        return [...(item.work?.targets || new Set())].filter((v) => v && v !== '—' && v !== '-');
    }
    function lensAttrs(item, extraSearch = []) {
        const targets = targetsForItem(item);
        const searchText = [
            item.spec.title,
            item.spec.relPath,
            item.row.group,
            item.row.item,
            item.area,
            item.maturity.label,
            ...targets,
            ...extraSearch,
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        return [
            'data-lens-item',
            `data-search="${escAttr(searchText)}"`,
            `data-area="${escAttr(attrValue(item.area))}"`,
            `data-maturity="${escAttr(attrValue(item.maturity.label))}"`,
            `data-type="${escAttr(attrValue(item.row.type || 'unspecified'))}"`,
            `data-target="${escAttr(targets.join('|'))}"`,
        ].join(' ');
    }
    function renderLensControls(items) {
        const distinct = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        const areas = distinct(items.map((item) => item.area));
        const maturities = distinct(items.map((item) => item.maturity.label));
        const types = distinct(items.map((item) => item.row.type || 'unspecified'));
        const targets = distinct(items.flatMap(targetsForItem));
        const select = (field, label, values) => {
            if (!values.length)
                return '';
            return `<label class="preview-filter-label">${escHtml(label)}<select class="preview-filter lens-filter" data-field="${escAttr(field)}"><option value="">All ${escHtml(label.toLowerCase())}</option>${values.map((v) => `<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('')}</select></label>`;
        };
        return `<div class="lens-controls">
    <input type="text" class="lens-search" placeholder="Filter this view…" />
    ${select('area', 'Area', areas)}
    ${select('maturity', 'Maturity', maturities)}
    ${select('type', 'Type', types)}
    ${select('target', 'Target', targets)}
    <button type="button" class="preview-reset lens-reset">Reset</button>
    <span class="lens-count"><strong class="lens-count-visible">${items.length}</strong> visible</span>
  </div>`;
    }
    const LENS_FILTER_SCRIPT = `
<script>
(function () {
  document.querySelectorAll('.lens-root').forEach(function(root) {
    var search = root.querySelector('.lens-search');
    var filters = root.querySelectorAll('.lens-filter');
    var reset = root.querySelector('.lens-reset');
    var count = root.querySelector('.lens-count-visible');
    var items = root.querySelectorAll('[data-lens-item]');
    function matchesField(item, field, value) {
      if (!value) return true;
      var raw = item.dataset[field] || '';
      if (field === 'target') return raw.split('|').indexOf(value) !== -1;
      return raw === value;
    }
    function apply() {
      var q = ((search && search.value) || '').trim().toLowerCase();
      var active = {};
      filters.forEach(function(f) { if (f.value) active[f.dataset.field] = f.value; });
      var visible = 0;
      items.forEach(function(item) {
        var textMatch = !q || (item.dataset.search || '').indexOf(q) !== -1;
        var filterMatch = Object.keys(active).every(function(field) { return matchesField(item, field, active[field]); });
        var show = textMatch && filterMatch;
        item.classList.toggle('filtered-out', !show);
        if (show) visible += 1;
      });
      if (count) count.textContent = visible;
      root.querySelectorAll('.kanban-column').forEach(function(column) {
        var cards = column.querySelectorAll('[data-lens-item]');
        var shown = column.querySelectorAll('[data-lens-item]:not(.filtered-out)').length;
        var badge = column.querySelector('.kanban-count');
        if (badge) badge.textContent = shown + (shown !== cards.length ? '/' + cards.length : '');
      });
    }
    if (search) search.addEventListener('input', apply);
    filters.forEach(function(f) { f.addEventListener('change', apply); });
    if (reset) reset.addEventListener('click', function() {
      if (search) search.value = '';
      filters.forEach(function(f) { f.value = ''; });
      apply();
    });
    apply();
  });
})();
</script>`;
    function governanceSignals(items) {
        const unassessed = items.filter((item) => item.maturity.label === 'Unassessed').length;
        const rework = items.filter((item) => item.maturity.label === 'Rework Needed').length;
        const missingSchema = items.filter((item) => !item.spec.frontmatter.spec_schema).length;
        const noRows = items.filter((item) => !item.work?.total && !item.backlog?.total).length;
        const noMaturityButWork = items.filter((item) => item.maturity.label === 'Unassessed' && ((item.work?.total || 0) > 0 || (item.backlog?.total || 0) > 0)).length;
        return [
            { level: 'R', title: 'Rework needed', note: 'Specs explicitly marked stale, wrong, or materially incomplete.', count: rework },
            { level: '0', title: 'Unassessed maturity', note: 'Specs not reviewed under the current maturity model.', count: unassessed },
            { level: 'S', title: 'Missing schema version', note: 'Specs without an explicit spec_schema frontmatter value.', count: missingSchema },
            { level: 'W', title: 'No tracked rows', note: 'Specs with no known work rows or backlog pressure rows.', count: noRows },
            { level: 'A', title: 'Active truth gap', note: 'Unassessed specs that already have work or backlog rows.', count: noMaturityButWork },
        ];
    }
    function renderGovernancePanel(items) {
        const rows = governanceSignals(items)
            .map((signal) => `<div class="governance-row">
      <div class="governance-level">${escHtml(signal.level)}</div>
      <div>
        <div class="governance-title">${escHtml(signal.title)}</div>
        <div class="governance-note">${escHtml(signal.note)}</div>
      </div>
      <span class="metric-pill${signal.count ? ' warn' : ' good'}">${signal.count}</span>
    </div>`)
            .join('');
        return `<div class="governance-list">${rows}</div>`;
    }
    function riskScore(item) {
        let score = 0;
        if (item.maturity.label === 'Rework Needed')
            score += 20;
        if (item.maturity.label === 'Unassessed')
            score += 8;
        score += (item.backlog?.openPressure || 0) * 2;
        score += item.work?.blocked ? item.work.blocked * 4 : 0;
        score += item.backlog?.blocked ? item.backlog.blocked * 4 : 0;
        score += item.work?.outstanding || 0;
        if (!item.spec.frontmatter.spec_schema)
            score += 2;
        return score;
    }
    function renderRiskList(items, limit = 8) {
        const risky = [...items]
            .map((item) => ({ item, score: riskScore(item) }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score || a.item.spec.title.localeCompare(b.item.spec.title))
            .slice(0, limit);
        if (!risky.length)
            return '<p class="dashboard-note">No risk signals in this scope.</p>';
        return `<div class="risk-list">${risky.map(({ item, score }) => `<div class="risk-item">
    <span class="risk-score">${score}</span>
    <div class="risk-title">
      <a href="${escHtml(item.spec.url)}">${escHtml(item.spec.title)}</a>
      <div class="risk-meta">${escHtml(item.area)} · ${escHtml(item.maturity.label)} · ${item.backlog?.openPressure || 0} pressure · ${item.work?.outstanding || 0} work</div>
    </div>
    ${renderSpecMaturityCell(item.spec)}
  </div>`).join('')}</div>`;
    }
    function renderSignalTiles(items) {
        const mature = items.filter((item) => maturityIndex(item.maturity.label) >= maturityIndex('Buildable') && item.maturity.label !== 'Rework Needed').length;
        const active = items.reduce((n, item) => n + (item.work?.active || 0) + (item.backlog?.active || 0), 0);
        const blocked = items.reduce((n, item) => n + (item.work?.blocked || 0) + (item.backlog?.blocked || 0), 0);
        const pressure = sumBacklogPressure(items);
        const outstanding = sumOutstanding(items);
        const schemaMissing = items.filter((item) => !item.spec.frontmatter.spec_schema).length;
        const tiles = [
            ['Buildable+', `${mature}/${items.length}`, 'Specs at Buildable or above'],
            ['Active Rows', String(active), 'Work/backlog currently moving'],
            ['Blocked Rows', String(blocked), 'Rows unable to progress'],
            ['Known Work', String(outstanding), 'Outstanding work rows'],
            ['Pressure', String(pressure), 'Unresolved backlog pressure'],
            ['Schema Gaps', String(schemaMissing), 'Specs missing schema version'],
        ];
        return `<div class="signal-grid">${tiles.map(([label, value, note]) => `<div class="signal-tile">
    <div class="signal-label">${escHtml(label)}</div>
    <div class="signal-value">${escHtml(value)}</div>
    <div class="insight-note">${escHtml(note)}</div>
  </div>`).join('')}</div>`;
    }
    function renderDashboardConsole(items, baseHref = '') {
        return `<section class="panel">
    <h2>Product Truth Console</h2>
    ${renderInsightCards(items, baseHref)}
    <div class="dashboard-grid">
      <div class="dashboard-stack">
        <div class="dashboard-panel">
          <h3>Operating Signals</h3>
          ${renderSignalTiles(items)}
        </div>
        <div class="dashboard-panel">
          <h3>Maturity Distribution</h3>
          ${renderMaturityStrip(items)}
        </div>
      </div>
      <div class="dashboard-stack">
        <div class="dashboard-panel">
          <h3>Highest Risk Specs</h3>
          ${renderRiskList(items, 8)}
        </div>
        <div class="dashboard-panel">
          <h3>Governance</h3>
          ${renderGovernancePanel(items)}
        </div>
      </div>
    </div>
  </section>`;
    }
    function renderInsightCards(items, baseHref = '') {
        const unassessed = items.filter((i) => i.maturity.label === 'Unassessed').length;
        const rework = items.filter((i) => i.maturity.label === 'Rework Needed').length;
        const outstanding = sumOutstanding(items);
        const pressure = sumBacklogPressure(items);
        const landed = sumLanded(items);
        return `
    <div class="insight-grid">
      <a class="insight-card" href="${baseHref}maturity.html">
        <div class="insight-label">Maturity</div>
        <div class="insight-value">${items.length - unassessed}</div>
        <div class="insight-note">${unassessed} unassessed${rework ? ` · ${rework} rework needed` : ''}</div>
      </a>
      <a class="insight-card" href="${baseHref}work.html">
        <div class="insight-label">Known Work</div>
        <div class="insight-value">${outstanding}</div>
        <div class="insight-note">${landed} landed work rows</div>
      </a>
      <a class="insight-card" href="${baseHref}pressure.html">
        <div class="insight-label">Backlog Pressure</div>
        <div class="insight-value">${pressure}</div>
        <div class="insight-note">open, triaged, active, or blocked backlog rows</div>
      </a>
      <a class="insight-card" href="${baseHref}releases.html">
        <div class="insight-label">Release Lens</div>
        <div class="insight-value">${new Set(items.flatMap((i) => [...(i.work?.targets || new Set())])).size}</div>
        <div class="insight-note">target releases/cycles represented</div>
      </a>
    </div>`;
    }
    function renderMaturityStrip(items) {
        const counts = new Map();
        for (const label of MATURITY_ORDER)
            counts.set(label, 0);
        for (const item of items)
            counts.set(item.maturity.label, (counts.get(item.maturity.label) || 0) + 1);
        return `<div class="maturity-strip">${MATURITY_ORDER.map((label) => {
            const info = MATURITY_LEVELS[label.toLowerCase()] || (label === 'Rework Needed' ? MATURITY_LEVELS['rework needed'] : MATURITY_LEVELS.unassessed);
            const count = counts.get(label) || 0;
            return `<div class="maturity-cell${label === 'Rework Needed' ? ' maturity-cell-warn' : ''}">
      <div class="maturity-cell-value">${count}</div>
      <div class="maturity-cell-label">${escHtml(info.level)} · ${escHtml(label)}</div>
    </div>`;
        }).join('')}</div>`;
    }
    function renderAreaMatrix(items) {
        const byArea = new Map();
        for (const item of items) {
            const list = byArea.get(item.area) || [];
            list.push(item);
            byArea.set(item.area, list);
        }
        const header = `<div class="area-row area-header">
    <div class="area-heading">Area</div>
    ${MATURITY_ORDER.map((label) => {
            const info = MATURITY_LEVELS[label.toLowerCase()] || (label === 'Rework Needed' ? MATURITY_LEVELS['rework needed'] : MATURITY_LEVELS.unassessed);
            return `<div class="area-col-label" title="${escAttr(label)}">${escHtml(info.level)}</div>`;
        }).join('')}
  </div>`;
        const rows = [...byArea.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([area, areaItems]) => {
            const counts = new Map();
            for (const item of areaItems)
                counts.set(item.maturity.label, (counts.get(item.maturity.label) || 0) + 1);
            return `<div class="area-row">
        <div class="area-name" title="${escAttr(area)}">${escHtml(area)}</div>
        ${MATURITY_ORDER.map((label) => {
                const count = counts.get(label) || 0;
                return `<div class="area-dot${count ? ' has-count' : ''}${label === 'Rework Needed' && count ? ' warn' : ''}" title="${escAttr(`${area}: ${count} ${label}`)}">${count || ''}</div>`;
            }).join('')}
      </div>`;
        })
            .join('');
        return `<div class="area-matrix">${header}${rows}</div>`;
    }
    const ACTIVITY_COLUMNS = [
        { key: 'active', label: 'Active' },
        { key: 'blocked', label: 'Blocked' },
        { key: 'queued', label: 'Queued Work' },
        { key: 'pressure', label: 'Backlog Pressure' },
        { key: 'landed', label: 'Landed / Resolved' },
        { key: 'parked', label: 'Parked' },
    ];
    function workBucket(status) {
        const v = status.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
        if (v === 'blocked')
            return 'blocked';
        if (v === 'active' || v === 'review' || v === 'in review' || v === 'in progress' || v === 'started' || v === 'alpha')
            return 'active';
        if (v === 'landed' || v === 'done' || v === 'implemented' || v === 'shipped')
            return 'landed';
        if (v === 'parked' || v === 'deferred')
            return 'parked';
        return 'queued';
    }
    function backlogBucket(status) {
        const v = status.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
        if (v === 'blocked')
            return 'blocked';
        if (v === 'active' || v === 'in progress' || v === 'started' || v === 'drafted')
            return 'active';
        if (v === 'resolved' || v === 'done' || v === 'closed')
            return 'landed';
        if (v === 'parked' || v === 'deferred')
            return 'parked';
        return 'pressure';
    }
    function buildActivityCards(section) {
        const cards = [];
        const subfeatures = snapshot.tables.subfeatures ? sectionRows(section, snapshot.tables.subfeatures) : [];
        const backlog = snapshot.tables.backlog ? sectionRows(section, snapshot.tables.backlog) : [];
        for (const row of subfeatures) {
            const specUrl = specPathToUrl.get(row.Spec);
            if (!specUrl)
                continue;
            const spec = specByPath.get(row.Spec);
            const preview = spec ? extractPreviewRow(spec.frontmatter) : null;
            cards.push({
                bucket: workBucket(String(row.Status || '')),
                kind: 'work',
                title: row.Subfeature || row.Item || row.Key || 'Work row',
                specTitle: specPathToTitle.get(row.Spec) || row.Spec,
                specUrl,
                area: spec ? topAreaForSpec(spec) : '',
                maturity: spec ? maturityForSpec(spec).label : '',
                type: row.Surface || preview?.type || 'work',
                status: row.Status || '',
                key: row.Key || '',
                target: row.Target || '',
            });
        }
        for (const row of backlog) {
            const specUrl = specPathToUrl.get(row.Spec);
            if (!specUrl)
                continue;
            const spec = specByPath.get(row.Spec);
            const preview = spec ? extractPreviewRow(spec.frontmatter) : null;
            cards.push({
                bucket: backlogBucket(String(row.Status || '')),
                kind: 'backlog',
                title: row.Item || row.Subfeature || row.Key || 'Backlog row',
                specTitle: specPathToTitle.get(row.Spec) || row.Spec,
                specUrl,
                area: spec ? topAreaForSpec(spec) : '',
                maturity: spec ? maturityForSpec(spec).label : '',
                type: row.Type || preview?.type || 'backlog',
                status: row.Status || '',
                key: row.Key || '',
                target: '',
            });
        }
        return cards;
    }
    function renderActivityBoard(cards, limitPerColumn = 14) {
        if (!cards.length)
            return '<p class="lens-muted">No activity rows found.</p>';
        return `<div class="kanban-board">${ACTIVITY_COLUMNS.map((col) => {
            const columnCards = cards
                .filter((card) => card.bucket === col.key)
                .sort((a, b) => a.specTitle.localeCompare(b.specTitle) || a.title.localeCompare(b.title));
            const visible = columnCards.slice(0, limitPerColumn);
            return `<section class="kanban-column">
      <div class="kanban-heading"><h3>${escHtml(col.label)}</h3><span class="kanban-count">${columnCards.length}</span></div>
      <div class="kanban-cards">
        ${visible.map((card) => {
                const searchText = [card.title, card.specTitle, card.area, card.maturity, card.kind, card.type, card.status, card.target].filter(Boolean).join(' ').toLowerCase();
                return `<article class="kanban-card" data-lens-item data-search="${escAttr(searchText)}" data-area="${escAttr(attrValue(card.area))}" data-maturity="${escAttr(attrValue(card.maturity))}" data-type="${escAttr(attrValue(card.type))}" data-target="${escAttr(card.target && card.target !== '—' ? card.target : '')}">
          <a href="${escHtml(card.specUrl)}">${escHtml(card.title)}</a>
          <div class="kanban-meta">
            ${card.key ? `<span class="kanban-chip">${escHtml(card.key)}</span>` : ''}
            <span class="kanban-chip">${escHtml(card.kind)}</span>
            ${card.type ? `<span class="kanban-chip">${escHtml(card.type)}</span>` : ''}
            ${card.status ? `<span class="kanban-chip">${escHtml(card.status)}</span>` : ''}
            ${card.target && card.target !== '—' ? `<span class="kanban-chip">${escHtml(card.target)}</span>` : ''}
          </div>
          <div class="work-path" title="${escAttr(card.specTitle)}">${escHtml(card.specTitle)}</div>
        </article>`;
            }).join('') || '<p class="lens-muted">No rows.</p>'}
        ${columnCards.length > visible.length ? `<div class="kanban-more">+${columnCards.length - visible.length} more rows</div>` : ''}
      </div>
    </section>`;
        }).join('')}</div>`;
    }
    function renderActivityControls(cards) {
        const distinct = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        const areas = distinct(cards.map((card) => card.area));
        const maturities = distinct(cards.map((card) => card.maturity));
        const types = distinct(cards.map((card) => card.type));
        const targets = distinct(cards.map((card) => card.target).filter((v) => v && v !== '—' && v !== '-'));
        const select = (field, label, values) => {
            if (!values.length)
                return '';
            return `<label class="preview-filter-label">${escHtml(label)}<select class="preview-filter lens-filter" data-field="${escAttr(field)}"><option value="">All ${escHtml(label.toLowerCase())}</option>${values.map((v) => `<option value="${escAttr(v)}">${escHtml(v)}</option>`).join('')}</select></label>`;
        };
        return `<div class="lens-controls">
    <input type="text" class="lens-search" placeholder="Filter board…" />
    ${select('area', 'Area', areas)}
    ${select('maturity', 'Maturity', maturities)}
    ${select('type', 'Type', types)}
    ${select('target', 'Target', targets)}
    <button type="button" class="preview-reset lens-reset">Reset</button>
    <span class="lens-count"><strong class="lens-count-visible">${cards.length}</strong> visible</span>
  </div>`;
    }
    function renderWorkRows(items, mode, limit = 24) {
        const sorted = [...items]
            .sort((a, b) => {
            const av = mode === 'work' ? (a.work?.outstanding || 0) : (a.backlog?.openPressure || 0);
            const bv = mode === 'work' ? (b.work?.outstanding || 0) : (b.backlog?.openPressure || 0);
            if (bv !== av)
                return bv - av;
            return a.spec.title.localeCompare(b.spec.title);
        })
            .filter((item) => (mode === 'work' ? (item.work?.total || 0) : (item.backlog?.total || 0)) > 0)
            .slice(0, limit);
        if (!sorted.length)
            return '<p class="lens-muted">No tracked rows found.</p>';
        return `<div class="work-list">${sorted.map((item) => {
            const outstanding = item.work?.outstanding || 0;
            const landed = item.work?.landed || 0;
            const pressure = item.backlog?.openPressure || 0;
            const resolved = item.backlog?.resolved || 0;
            return `<div class="work-row" ${lensAttrs(item)}>
      <div class="work-title">
        <a href="${escHtml(item.spec.url)}">${escHtml(item.spec.title)}</a>
        <div class="work-path">${escHtml(item.folder || item.spec.relPath)}</div>
      </div>
      <div><span class="metric-pill${mode === 'work' && outstanding ? ' warn' : ''}">${mode === 'work' ? outstanding : pressure}</span></div>
      <div class="lens-muted">${mode === 'work' ? `${landed} landed` : `${resolved} resolved`}</div>
      <div>${renderSpecMaturityCell(item.spec)}</div>
    </div>`;
        }).join('')}</div>`;
    }
    function renderMaturityRows(items, limit = 24) {
        const sorted = [...items]
            .sort((a, b) => {
            const ai = maturityIndex(a.maturity.label);
            const bi = maturityIndex(b.maturity.label);
            if (ai !== bi)
                return ai - bi;
            const pressureDelta = (b.backlog?.openPressure || 0) - (a.backlog?.openPressure || 0);
            if (pressureDelta !== 0)
                return pressureDelta;
            return a.spec.title.localeCompare(b.spec.title);
        })
            .slice(0, limit);
        if (!sorted.length)
            return '<p class="lens-muted">No specs found.</p>';
        return `<div class="work-list">${sorted.map((item) => `<div class="work-row" ${lensAttrs(item)}>
      <div class="work-title">
        <a href="${escHtml(item.spec.url)}">${escHtml(item.spec.title)}</a>
        <div class="work-path">${escHtml(item.folder || item.spec.relPath)}</div>
      </div>
      <div>${renderSpecMaturityCell(item.spec)}</div>
      <div class="lens-muted">${item.work?.outstanding || 0} work</div>
      <div class="lens-muted">${item.backlog?.openPressure || 0} pressure</div>
    </div>`).join('')}</div>`;
    }
    function renderReleaseTable(items, kind) {
        const counts = new Map();
        for (const item of items) {
            const values = kind === 'targets' ? item.work?.targets : item.work?.delivered;
            for (const v of values || [])
                counts.set(v, (counts.get(v) || 0) + 1);
        }
        const rows = [...counts.entries()]
            .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map(([release, count]) => `<tr><td>${escHtml(release)}</td><td class="lens-num">${count}</td></tr>`)
            .join('');
        return `<table class="lens-table"><thead><tr><th>${kind === 'targets' ? 'Target' : 'Delivered'}</th><th>Rows</th></tr></thead><tbody>${rows || '<tr><td colspan="2" class="lens-muted">No release values recorded.</td></tr>'}</tbody></table>`;
    }
    function renderSchemaBox(title, fields) {
        return `<section class="schema-box">
    <h3>${escHtml(title)}</h3>
    ${fields.map(([key, desc]) => `<div class="schema-field"><div class="schema-key">${escHtml(key)}</div><div class="schema-desc">${escHtml(desc)}</div></div>`).join('')}
  </section>`;
    }
    function renderSchemaReference() {
        const maturityValues = MATURITY_ORDER.map((label) => {
            const info = MATURITY_LEVELS[label.toLowerCase()] || (label === 'Rework Needed' ? MATURITY_LEVELS['rework needed'] : MATURITY_LEVELS.unassessed);
            return `${info.level}=${label}`;
        }).join(', ');
        return `<div class="schema-grid">
    ${renderSchemaBox('Spec frontmatter', [
            ['maturity', `Current trust level for the spec. Values: ${maturityValues}.`],
            ['spec_schema', 'Version of the spec document schema used by this file.'],
            ['roadmap_*', 'Current legacy grouping fields used to place specs in the corpus views.'],
            ['doc_type / spec_type', 'Optional type hint for non-feature specs such as decision records, schemas, or operating docs.'],
        ])}
    ${renderSchemaBox('Known work rows', [
            ['Key', 'Stable row identifier within the spec.'],
            ['Subfeature', 'The work item or capability being tracked.'],
            ['Surface', 'Where the work lands, such as mobile, web, backend, ops, or docs.'],
            ['Status', 'Work state. Common values: Planned, Queued, Active, Review, Blocked, Landed, Parked.'],
            ['Target', 'Release/cycle intent. This is not maturity.'],
            ['Delivered', 'Historical delivery fact. This is not maturity.'],
            ['Notes', 'Short context for agents and humans.'],
        ])}
    ${renderSchemaBox('Backlog rows', [
            ['Key', 'Stable backlog row identifier within the spec.'],
            ['Type', 'Pressure type, such as decision, dependency, enhancement, question, risk, or cleanup.'],
            ['Item', 'The unresolved pressure or candidate work.'],
            ['Status', 'Backlog state. Common values: Open, Triaged, Active, Blocked, Resolved, Parked.'],
            ['Notes', 'Decision context, default proposal, or follow-up clue.'],
        ])}
    ${renderSchemaBox('Derived views', [
            ['Maturity Map', 'Counts maturity by spec and by area. Missing maturity is Unassessed.'],
            ['Activity Board', 'Groups known work and backlog rows by current activity state.'],
            ['Known Work', 'Counts outstanding implementation/design rows from spec tracking tables.'],
            ['Backlog Pressure', 'Counts unresolved backlog pressure separately from committed work.'],
            ['Release Lens', 'Shows Target and Delivered as intent/history, separate from maturity.'],
        ])}
  </div>`;
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
            const maturityPage = {
                key: 'maturity',
                label: 'Maturity',
                href: routeFor(section.slug, 'maturity'),
            };
            const activityPage = {
                key: 'activity',
                label: 'Activity Board',
                href: routeFor(section.slug, 'activity'),
            };
            const workPage = {
                key: 'work',
                label: 'Known Work',
                href: routeFor(section.slug, 'work'),
            };
            const pressurePage = {
                key: 'pressure',
                label: 'Backlog Pressure',
                href: routeFor(section.slug, 'pressure'),
            };
            const releasesPage = {
                key: 'releases',
                label: 'Releases',
                href: routeFor(section.slug, 'releases'),
            };
            const schemaPage = {
                key: 'schema',
                label: 'Schema',
                href: routeFor(section.slug, 'schema'),
            };
            const tablePage = {
                key: 'table',
                label: 'Specs (table)',
                href: routeFor(section.slug, 'table'),
            };
            const hasOverview = section.pages.some((p) => p.key === 'index');
            if (hasOverview) {
                section.pages.push(maturityPage, activityPage, workPage, pressurePage, releasesPage, schemaPage, specsPage, tablePage);
            }
            else {
                // No Overview in this mode — Maturity becomes the section's entry page.
                section.pages.unshift(maturityPage, activityPage, workPage, pressurePage, releasesPage, schemaPage, specsPage, tablePage);
            }
        }
    }
    copyFileSync(SNAPSHOT_PATH, join(OUTPUT_DIR, 'roadmaps.json'));
    const searchIndex = [
        {
            title: 'Product Truth Overview',
            section: 'Overview',
            group: '',
            snippet: 'Product truth home with maturity, known work, backlog pressure, and release views.',
            url: 'index.html',
        },
        {
            title: 'Search',
            section: 'Overview',
            group: '',
            snippet: 'Search across product truth views, tracked rows, and workstream sections.',
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
      ${sectionDelivery ? `<div class="progress-group"><h3>Known work <span class="progress-group-note">Subfeatures/work rows — see each spec page for detail</span></h3>${renderProgress(sectionDelivery)}</div>` : ''}
      ${sectionBacklog ? `<div class="progress-group"><h3>Backlog pressure <span class="progress-group-note">Open questions and tracked pressure — see each spec page for detail</span></h3>${renderProgress(sectionBacklog)}</div>` : ''}
    </section>`
            : '';
        const sectionCrumbs = renderBreadcrumbs([
            { label: 'Product Truth', href: 'index.html' },
            { label: section.label },
        ]);
        const overviewBody = `
    <section class="hero">
      <div class="eyebrow">Kinetiq Core</div>
      ${sectionCrumbs}
      <h1>${escHtml(section.label)}</h1>
      <p class="subhead">${section.source ? `Repository-specific product truth views for ${escHtml(section.source.label)}.` : 'Combined cross-repo product truth views across all configured sources.'}</p>
      <div class="meta">Snapshot generated ${escHtml(snapshot.generatedAt)} via ${escHtml(snapshot.generatedBy)}</div>
      ${PROGRESS_LEGEND_HTML}
      <div class="links">
        <a href="index.html">Product Truth home</a>
        <a href="roadmaps.json">Snapshot JSON</a>
      </div>
      <div class="grid">${sectionCards || '<div class="source-meta">No product truth views available for this section.</div>'}</div>
    </section>
    ${progressPanel}
    ${sourcePanel}
  `;
        // Skip the section-overview write in single-source mode — the root
        // index already covers this ground (overall progress + L1/L2 breakdown).
        if (section.pages.some((p) => p.key === 'index')) {
            const pagePath = routeFor(section.slug, 'index');
            writeFileSync(join(OUTPUT_DIR, pagePath), pageShell(`${section.label} — Product Truth`, sections, section.slug, 'index', overviewBody, pagePath));
            searchIndex.push({
                title: `${section.label} Overview`,
                section: section.label,
                group: '',
                snippet: section.source ? `Repository-specific product truth views for ${section.source.label}.` : 'Combined cross-repo product truth views.',
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
                { label: 'Product Truth', href: 'index.html' },
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
    for (const section of sections) {
        const specs = section.source
            ? specsBySource.get(section.source.id) || []
            : allSpecs.slice();
        if (!specs.length)
            continue;
        const items = buildInsightSpecs(specs);
        const activityCards = buildActivityCards(section);
        const headingPrefix = SINGLE_SOURCE_MODE ? '' : `${section.label} — `;
        const crumbsFor = (label) => renderBreadcrumbs([
            { label: 'Product Truth', href: 'index.html' },
            { label: section.label, href: routeFor(section.slug, 'index') },
            { label },
        ]);
        const maturityBody = `
    <section class="hero">
      <div class="eyebrow">Product Truth</div>
      ${crumbsFor('Maturity')}
      <h1>${escHtml(`${headingPrefix}Maturity Map`)}</h1>
      <p class="subhead">How much the spec corpus is trusted as product truth. Missing maturity is shown as Unassessed, not as success.</p>
      ${renderInsightCards(items)}
    </section>
    <section class="panel">
      <h2>Maturity heatmap</h2>
      ${renderMaturityStrip(items)}
    </section>
    <section class="panel">
      <h2>Maturity by area</h2>
      ${renderAreaMatrix(items)}
    </section>
    <section class="panel lens-root">
      <h2>Lowest maturity specs</h2>
      ${renderLensControls(items)}
      ${renderMaturityRows(items, 18)}
    </section>
    ${LENS_FILTER_SCRIPT}`;
        const maturityPath = routeFor(section.slug, 'maturity');
        writeFileSync(join(OUTPUT_DIR, maturityPath), pageShell(`${headingPrefix}Maturity Map`, sections, section.slug, 'maturity', maturityBody, maturityPath));
        const activityBody = `
    <section class="hero">
      <div class="eyebrow">Product Truth</div>
      ${crumbsFor('Activity Board')}
      <h1>${escHtml(`${headingPrefix}Activity Board`)}</h1>
      <p class="subhead">A kanban-style view of current work and backlog activity. It shows state, not permanent completeness.</p>
      ${renderInsightCards(items)}
    </section>
    <section class="panel lens-root">
      <h2>Activity board</h2>
      ${renderActivityControls(activityCards)}
      ${renderActivityBoard(activityCards)}
    </section>
    ${LENS_FILTER_SCRIPT}`;
        const activityPath = routeFor(section.slug, 'activity');
        writeFileSync(join(OUTPUT_DIR, activityPath), pageShell(`${headingPrefix}Activity Board`, sections, section.slug, 'activity', activityBody, activityPath));
        const workBody = `
    <section class="hero">
      <div class="eyebrow">Product Truth</div>
      ${crumbsFor('Known Work')}
      <h1>${escHtml(`${headingPrefix}Known Work`)}</h1>
      <p class="subhead">Known implementation/design work remaining in the corpus. Counts come from work rows, not estimated percent complete.</p>
      ${renderInsightCards(items)}
    </section>
    <section class="panel lens-root">
      <h2>Most outstanding work</h2>
      ${renderLensControls(items)}
      ${renderWorkRows(items, 'work', 40)}
    </section>
    ${LENS_FILTER_SCRIPT}`;
        const workPath = routeFor(section.slug, 'work');
        writeFileSync(join(OUTPUT_DIR, workPath), pageShell(`${headingPrefix}Known Work`, sections, section.slug, 'work', workBody, workPath));
        const pressureBody = `
    <section class="hero">
      <div class="eyebrow">Product Truth</div>
      ${crumbsFor('Backlog Pressure')}
      <h1>${escHtml(`${headingPrefix}Backlog Pressure`)}</h1>
      <p class="subhead">Unresolved decisions, dependencies, candidate enhancements, and other tracked pressure that has not necessarily become committed work.</p>
      ${renderInsightCards(items)}
    </section>
    <section class="panel lens-root">
      <h2>Highest pressure specs</h2>
      ${renderLensControls(items)}
      ${renderWorkRows(items, 'pressure', 40)}
    </section>
    ${LENS_FILTER_SCRIPT}`;
        const pressurePath = routeFor(section.slug, 'pressure');
        writeFileSync(join(OUTPUT_DIR, pressurePath), pageShell(`${headingPrefix}Backlog Pressure`, sections, section.slug, 'pressure', pressureBody, pressurePath));
        const releaseBody = `
    <section class="hero">
      <div class="eyebrow">Product Truth</div>
      ${crumbsFor('Releases')}
      <h1>${escHtml(`${headingPrefix}Release Lens`)}</h1>
      <p class="subhead">Target is intent. Delivered is historical fact. This view keeps both visible without treating either as maturity.</p>
      ${renderInsightCards(items)}
    </section>
    <section class="panel">
      <h2>Release rows</h2>
      <div class="lens-grid release-grid">
        <div class="lens-stack">
          <h3>Targets</h3>
          ${renderReleaseTable(items, 'targets')}
        </div>
        <div class="lens-stack">
          <h3>Delivered</h3>
          ${renderReleaseTable(items, 'delivered')}
        </div>
      </div>
    </section>
    <section class="panel lens-root">
      <h2>Specs with outstanding work</h2>
      ${renderLensControls(items)}
      ${renderWorkRows(items, 'work', 24)}
    </section>
    ${LENS_FILTER_SCRIPT}`;
        const releasePath = routeFor(section.slug, 'releases');
        writeFileSync(join(OUTPUT_DIR, releasePath), pageShell(`${headingPrefix}Release Lens`, sections, section.slug, 'releases', releaseBody, releasePath));
        const schemaBody = `
    <section class="hero">
      <div class="eyebrow">Product Truth</div>
      ${crumbsFor('Schema')}
      <h1>${escHtml(`${headingPrefix}Schema`)}</h1>
      <p class="subhead">The current human and agent-facing schema of the corpus: fields, vocabulary, and derived views.</p>
      ${renderInsightCards(items)}
    </section>
    <section class="panel">
      <h2>Governance signals</h2>
      ${renderGovernancePanel(items)}
    </section>
    <section class="panel">
      <h2>Relevant fields</h2>
      ${renderSchemaReference()}
    </section>`;
        const schemaPath = routeFor(section.slug, 'schema');
        writeFileSync(join(OUTPUT_DIR, schemaPath), pageShell(`${headingPrefix}Schema`, sections, section.slug, 'schema', schemaBody, schemaPath));
        searchIndex.push({ title: `${headingPrefix}Maturity Map`, section: section.label, group: 'Product Truth', snippet: 'Maturity heatmap and area matrix.', url: maturityPath }, { title: `${headingPrefix}Activity Board`, section: section.label, group: 'Product Truth', snippet: 'Kanban-style activity view for work and backlog rows.', url: activityPath }, { title: `${headingPrefix}Known Work`, section: section.label, group: 'Product Truth', snippet: 'Outstanding known work by spec.', url: workPath }, { title: `${headingPrefix}Backlog Pressure`, section: section.label, group: 'Product Truth', snippet: 'Open backlog pressure by spec.', url: pressurePath }, { title: `${headingPrefix}Release Lens`, section: section.label, group: 'Product Truth', snippet: 'Target and delivered release facts.', url: releasePath }, { title: `${headingPrefix}Schema`, section: section.label, group: 'Product Truth', snippet: 'Relevant fields and vocabulary for the spec corpus.', url: schemaPath });
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
            { label: 'Product Truth', href: 'index.html' },
            { label: spec.sourceLabel, href: backToSectionHref },
            { label: 'Specs', href: backToSpecsHref },
            ...folderSegments.map((seg) => ({ label: seg })),
            { label: rendered.title },
        ]);
        const frontmatterPairs = Object.entries(spec.frontmatter)
            .filter(([k]) => k.startsWith('roadmap_') || k === 'maturity' || k === 'spec_maturity' || k === 'doc_type' || k === 'spec_type')
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
    ${renderSpecRecordHeader(spec)}
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
            roll.shipped && `${roll.shipped} landed`,
            roll.beta && `${roll.beta} validated`,
            roll.alpha && `${roll.alpha} active/review`,
            roll.planned && `${roll.planned} queued`,
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
        const maturity = maturityForSpec(spec);
        const searchText = [spec.title, spec.relPath, row.group, row.item, maturity.label].filter(Boolean).join(' ').toLowerCase();
        const dataAttrs = [
            `data-search="${escAttr(searchText)}"`,
            `data-type="${escAttr(row.type || '—')}"`,
            `data-maturity="${escAttr(maturity.label)}"`,
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
    <span class="preview-cell preview-cell-maturity">${renderSpecMaturityCell(spec)}</span>
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
    function distinctMaturityValues(specs) {
        const set = new Set();
        for (const spec of specs)
            set.add(maturityForSpec(spec).label);
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

  var toggleBtn = root.querySelector('.preview-toggle-all');
  if (toggleBtn) {
    var allFolders = root.querySelectorAll('details.spec-tree-folder');
    toggleBtn.addEventListener('click', function () {
      var expanded = toggleBtn.dataset.state === 'expanded';
      allFolders.forEach(function (d) { d.open = !expanded; });
      toggleBtn.dataset.state = expanded ? 'collapsed' : 'expanded';
      toggleBtn.textContent = expanded ? 'Expand all' : 'Collapse all';
    });
  }

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
            { label: 'Product Truth', href: 'index.html' },
            { label: section.label, href: routeFor(section.slug, 'index') },
            { label: 'Specs' },
        ]);
        const typeValues = distinctValues(specs, (r) => r.type);
        const maturityValues = distinctMaturityValues(specs);
        const filterBar = `
    <div class="preview-controls">
      <input type="text" class="preview-search" placeholder="Filter by title, path, item…" />
      ${renderFilterSelect('type', 'Type', typeValues)}
      ${renderFilterSelect('maturity', 'Maturity', maturityValues)}
      <button type="button" class="preview-reset">Reset</button>
      <button type="button" class="preview-toggle-all" data-state="expanded">Collapse all</button>
      <span class="preview-count"><span class="preview-count-visible">${specs.length} of ${specs.length}</span> specs</span>
    </div>`;
        const headerStrip = `
    <div class="preview-header">
      <span class="preview-header-spec">Spec</span>
      <span class="preview-cell preview-cell-type">Type</span>
      <span class="preview-cell preview-cell-item">Item</span>
      <span class="preview-cell preview-cell-maturity">Maturity</span>
      <span class="preview-cell preview-cell-status">Known work</span>
      <span class="preview-cell preview-cell-delivery">Delivery</span>
      <span class="preview-cell preview-cell-backlog">Backlog pressure</span>
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
        // ---- Table view (flat list, same data) ----
        const tableUrl = routeFor(section.slug, 'table');
        const tableHeading = SINGLE_SOURCE_MODE ? 'Specs (table)' : `${section.label} — Specs (table)`;
        const tableCrumbs = renderBreadcrumbs([
            { label: 'Product Truth', href: 'index.html' },
            { label: section.label, href: routeFor(section.slug, 'index') },
            { label: 'Specs (table)' },
        ]);
        const specRowsSorted = specs.slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
        const tableRows = specRowsSorted
            .map((spec) => {
            const row = extractPreviewRow(spec.frontmatter);
            const maturity = maturityForSpec(spec);
            const filename = spec.relPath.split('/').pop() || spec.relPath;
            let segments = spec.relPath.split('/').filter(Boolean);
            if (segments[0] === 'specs')
                segments = segments.slice(1);
            const folderSegs = segments.slice(0, -1);
            const pathLabel = folderSegs.join(' › ');
            const searchText = [spec.title, spec.relPath, row.group, row.item, maturity.label].filter(Boolean).join(' ').toLowerCase();
            return `<tr class="preview-row spec-table-row" data-search="${escAttr(searchText)}" data-type="${escAttr(row.type || '—')}" data-maturity="${escAttr(maturity.label)}">
        <td class="spec-table-path" title="${escAttr(folderSegs.join('/'))}">${escHtml(pathLabel)}</td>
        <td class="spec-table-spec"><a href="${escHtml(spec.url)}">${escHtml(spec.title)}</a><span class="spec-table-file">${escHtml(filename)}</span></td>
        <td class="spec-table-type">${row.type ? `<span class="type-badge type-${escAttr(row.type)}">${escHtml(row.type)}</span>` : '<span class="preview-empty">—</span>'}</td>
        <td class="spec-table-item" title="${escAttr(row.item)}">${row.item ? escHtml(row.item) : '<span class="preview-empty">—</span>'}</td>
        <td class="spec-table-maturity">${renderSpecMaturityCell(spec)}</td>
        <td class="spec-table-status">${renderSpecStatusCell(specStatsByPath.get(spec.specPath))}</td>
        <td class="spec-table-delivery">${renderSpecDeliveryCell(specStatsByPath.get(spec.specPath))}</td>
        <td class="spec-table-backlog">${renderSpecBacklogCell(specBacklogStatsByPath.get(spec.specPath))}</td>
      </tr>`;
        })
            .join('');
        const tableFilterBar = `
    <div class="preview-controls">
      <input type="text" class="preview-search" placeholder="Filter by title, path, item…" />
      ${renderFilterSelect('type', 'Type', typeValues)}
      ${renderFilterSelect('maturity', 'Maturity', maturityValues)}
      <button type="button" class="preview-reset">Reset</button>
      <span class="preview-count"><span class="preview-count-visible">${specs.length} of ${specs.length}</span> specs</span>
    </div>`;
        const tableBody = `
    <section class="hero">
      <div class="eyebrow">Kinetiq Core</div>
      ${tableCrumbs}
      <h1>${escHtml(tableHeading)}</h1>
      <p class="subhead">Flat table of ${specs.length} spec${specs.length === 1 ? '' : 's'}. Same data as the tree browser; sorted by folder path.</p>
    </section>
    <section class="panel" id="specs-preview-root">
      ${tableFilterBar}
      <table class="spec-table">
        <thead>
          <tr>
            <th class="spec-table-path">Path</th>
            <th class="spec-table-spec">Spec</th>
            <th class="spec-table-type">Type</th>
            <th class="spec-table-item">Item</th>
            <th class="spec-table-maturity">Maturity</th>
            <th class="spec-table-status">Known work</th>
            <th class="spec-table-delivery">Delivery</th>
            <th class="spec-table-backlog">Backlog pressure</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="8">No specs found.</td></tr>'}</tbody>
      </table>
    </section>
    ${PREVIEW_SCRIPT}
  `;
        const tablePath = join(OUTPUT_DIR, tableUrl);
        ensureDir(dirname(tablePath));
        writeFileSync(tablePath, pageShell(tableHeading, sections, section.slug, 'table', tableBody, tableUrl));
        searchIndex.push({
            title: tableHeading,
            section: section.label,
            group: 'Specs',
            snippet: `Flat table view of ${specs.length} specs.`,
            url: tableUrl,
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
    const rootInsightItems = buildInsightSpecs(allSpecs);
    const rootInsightBaseHref = SINGLE_SOURCE_MODE ? '' : 'portfolio/';
    const overallProgressPanel = renderDashboardConsole(rootInsightItems, rootInsightBaseHref);
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
    <h1>Product Truth</h1>
    <p class="subhead">Living blueprints across the product. Start with maturity, activity, known work, backlog pressure, release facts, and the schema reference; use the spec browser only when you need the full corpus drilldown.</p>
    <div class="meta">Snapshot generated ${escHtml(snapshot.generatedAt)} via ${escHtml(snapshot.generatedBy)}</div>
    ${PROGRESS_LEGEND_HTML}
    <div class="links">
      <a href="${rootInsightBaseHref}maturity.html">Maturity Map</a>
      <a href="${rootInsightBaseHref}activity.html">Activity Board</a>
      <a href="${rootInsightBaseHref}work.html">Known Work</a>
      <a href="${rootInsightBaseHref}pressure.html">Backlog Pressure</a>
      <a href="${rootInsightBaseHref}releases.html">Release Lens</a>
      <a href="${rootInsightBaseHref}schema.html">Schema</a>
    </div>
  </section>
  ${overallProgressPanel}
  ${rootBreakdown}
  <section class="panel">
    <h2>Sources</h2>
    <div class="source-list">${rootSourceRows || '<p>No sources recorded.</p>'}</div>
  </section>
`;
    writeFileSync(join(OUTPUT_DIR, 'index.html'), pageShell('Product Truth', sections, 'root', 'index', indexBody, 'index.html'));
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
