/**
 * HTML renderer — server-side pages for the `--report` viewer.
 *
 * Two entry points, one visual language (shared with the runner's per-suite
 * report at `src/runner/suite-report.ts` — same tokens, same components, minor
 * mode-specific tweaks):
 *
 *   renderIndexPage(index)   → aggregate history at `/`
 *   renderRunPage(manifest)  → per-run Step Inspector at `/runs/:runId`
 *
 * Screenshots and videos are streamed from `/artifacts/…` (the server route
 * pulls them from the base64 store in the manifest). We deliberately do NOT
 * inline artifacts here — the server-mode page loads fast and lets the browser
 * cache. The per-suite report keeps embedding for offline portability.
 */

import type { RunIndex, RunIndexEntry, RunManifest, StepArtifact, SuiteEntry } from './types.js';

/* ─── shared formatting helpers ─────────────────────────────────── */

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDur(ms: number): string {
  if (!ms) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function fmtClock(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function iconAndroid(): string {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.532 15.106a1.003 1.003 0 1 1 .001-2.007 1.003 1.003 0 0 1 0 2.007zm-11.063 0a1.003 1.003 0 1 1 .001-2.007 1.003 1.003 0 0 1 0 2.007zm11.371-4.464 1.977-3.424a.41.41 0 0 0-.15-.56.41.41 0 0 0-.56.15L17.1 10.255a12.63 12.63 0 0 0-5.1-1.033 12.63 12.63 0 0 0-5.1 1.033L4.893 6.808a.41.41 0 0 0-.56-.15.41.41 0 0 0-.15.56l1.977 3.424C2.565 12.736.002 16.412.002 20.6h24c0-4.188-2.563-7.864-6.162-9.958z"/></svg>';
}
function iconApple(): string {
  return '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>';
}

/* ─── analytics compute ─────────────────────────────────────────── */

interface DayStats {
  date: string;
  passed: number;
  failed: number;
}

function computeTrendData(runs: RunIndexEntry[], days = 14): DayStats[] {
  const now = new Date();
  const buckets: DayStats[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    buckets.push({ date: key, passed: 0, failed: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.date, i]));
  for (const r of runs) {
    const key = r.startedAt.slice(0, 10);
    const at = idx.get(key);
    if (at == null) continue;
    if (r.success) buckets[at].passed++;
    else buckets[at].failed++;
  }
  return buckets;
}

function renderSparklineSvg(trend: DayStats[], w = 320, h = 60): string {
  const n = trend.length;
  if (n < 2) return `<svg width="${w}" height="${h}"></svg>`;
  const totals = trend.map((d) => d.passed + d.failed);
  const maxTotal = Math.max(1, ...totals);
  const xStep = w / (n - 1);
  const pad = 4;
  const poly = (getter: (d: DayStats) => number, color: string): string => {
    const pts = trend
      .map((d, i) => {
        const x = (i * xStep).toFixed(1);
        const y = (h - pad - (getter(d) / maxTotal) * (h - pad * 2)).toFixed(1);
        return `${x},${y}`;
      })
      .join(' ');
    return `<polyline points="${pts}" stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.92"/>`;
  };
  const dots = (getter: (d: DayStats) => number, color: string): string =>
    trend
      .map((d, i) => {
        const v = getter(d);
        if (v === 0) return '';
        const cx = (i * xStep).toFixed(1);
        const cy = (h - pad - (v / maxTotal) * (h - pad * 2)).toFixed(1);
        return `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${color}" opacity="0.9"/>`;
      })
      .join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" style="width:100%;height:${h}px">
    ${poly((d) => d.passed, 'var(--pass)')}
    ${poly((d) => d.failed, 'var(--fail)')}
    ${dots((d) => d.passed, 'var(--pass)')}
    ${dots((d) => d.failed, 'var(--fail)')}
  </svg>`;
}

function mostFailingTests(
  runs: RunIndexEntry[],
  limit = 3
): Array<{ name: string; failures: number; total: number }> {
  // Group by test identity — prefer the test title (flowName), falling back to
  // the spec file. The historical `flowFile` is now the `'sdk-run'` stub for
  // SDK-driven tests, so we can't use it as an identity key.
  const map = new Map<string, { name: string; failures: number; total: number }>();
  for (const r of runs) {
    const name = testTitle(r);
    const key = `${r.specFile ?? ''}::${name}`;
    if (!map.has(key)) map.set(key, { name, failures: 0, total: 0 });
    const e = map.get(key)!;
    e.total++;
    if (!r.success) e.failures++;
  }
  return [...map.values()]
    .filter((f) => f.failures > 0)
    .sort((a, b) => b.failures - a.failures || b.total - a.total)
    .slice(0, limit);
}

/* ─── shared HTML pieces (head, styles, script core) ─────────────── */

function head(title: string, injectedGlobals = ''): string {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<script>(function(){try{var t=localStorage.getItem('appclaw-report-theme');if(t==='light')document.documentElement.classList.add('preload-light');}catch(e){}})();</script>
${injectedGlobals}
<style>${styles()}</style>`;
}

function themeToggle(): string {
  return `<button id="theme-toggle" class="theme-toggle" onclick="toggleTheme()" aria-label="toggle light / dark theme" title="Toggle theme">☾</button>`;
}

/** Shared theme + utility script installed on every page. */
function themeScript(): string {
  return `
function applyTheme(t){
  document.body.classList.toggle('light',t==='light');
  document.documentElement.classList.remove('preload-light');
  var b=document.getElementById('theme-toggle'); if(b)b.textContent=t==='light'?'☀':'☾';
  try{localStorage.setItem('appclaw-report-theme',t);}catch(e){}
}
function toggleTheme(){applyTheme(document.body.classList.contains('light')?'dark':'light');}
(function(){var s;try{s=localStorage.getItem('appclaw-report-theme');}catch(e){} if(s)applyTheme(s);})();
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmt(ms){if(!ms)return'0s';if(ms<1000)return ms+'ms';var s=ms/1000;return s<60?s.toFixed(1)+'s':Math.floor(s/60)+'m '+Math.round(s%60)+'s';}
function glyph(s){return s==='passed'?'✓':s==='failed'?'✗':'⊘';}
`;
}

/* ═══════════════════════════════════════════════════════════════════
 * Mode B — aggregate history at `/`
 * ═══════════════════════════════════════════════════════════════════ */

export function renderIndexPage(index: RunIndex): string {
  const allRuns = [...index.runs].sort((a, b) => (b.startedAt < a.startedAt ? -1 : 1));
  const suites = [...(index.suites ?? [])].sort((a, b) => (b.startedAt < a.startedAt ? -1 : 1));

  // Aggregate stats derive from runs that belong to a visible SuiteEntry only —
  // matches the fact that the page shows suites-only. Orphaned runs (a suite
  // that crashed or was interrupted before finalizing its SuiteEntry, so its
  // runs exist in the index but not under any suite) would otherwise skew the
  // tiles and analytics without ever appearing in the results list.
  const inSuite = new Set<string>();
  for (const s of suites) for (const id of s.runIds) inSuite.add(id);
  const runs = allRuns.filter((r) => inSuite.has(r.runId));

  const passed = runs.filter((r) => r.success).length;
  const failed = runs.length - passed;
  const totalSteps = runs.reduce((n, r) => n + (r.stepsExecuted || 0), 0);
  const totalWall = runs.reduce((n, r) => n + (r.durationMs || 0), 0);
  const durationRuns = runs.filter((r) => r.durationMs > 0);
  const avgMs =
    durationRuns.length > 0
      ? Math.round(durationRuns.reduce((n, r) => n + r.durationMs, 0) / durationRuns.length)
      : 0;
  const passRate = runs.length > 0 ? Math.round((passed / runs.length) * 100) : 100;
  const latest = runs[0];
  const verdict = runs.length === 0 ? 'EMPTY' : latest.success ? 'PASSED' : 'FAILED';

  return `<!DOCTYPE html>
<html lang="en">
<head>
${head('AppClaw · Reports')}
</head>
<body>
<div class="grain"></div>
${themeToggle()}
<main>
  <header class="cockpit reveal">
    ${renderHistoryHero({
      verdict,
      passRate,
      runCount: runs.length,
      passed,
      failed,
      latest,
      avgMs,
      stats: { total: runs.length, passed, failed, avgMs, totalSteps, totalWall },
    })}
    ${renderAnalytics(runs)}
  </header>
  <section class="dash-body reveal">
    <aside class="dash-side">
      ${renderDevicesSidebar(runs)}
    </aside>
    <div class="dash-main">
      ${renderResults(runs, suites)}
    </div>
  </section>
  ${renderFooter(index)}
</main>
<script>${themeScript()}</script>
<script>window.__INDEX__=${embedJson({ generatedAt: index.generatedAt })};</script>
<script>${historyScript()}</script>
</body>
</html>`;
}

function renderHistoryHero(d: {
  verdict: string;
  passRate: number;
  runCount: number;
  passed: number;
  failed: number;
  latest: RunIndexEntry | undefined;
  avgMs: number;
  stats: {
    total: number;
    passed: number;
    failed: number;
    avgMs: number;
    totalSteps: number;
    totalWall: number;
  };
}): string {
  const R = 34;
  const C = 2 * Math.PI * R;
  const dash = (d.passRate / 100) * C;
  const latestChip = d.latest
    ? `<span class="chip">latest ${esc(fmtDateShort(d.latest.startedAt))}</span>`
    : '';
  const runsLabel = `${d.runCount} test${d.runCount === 1 ? '' : 's'}`;

  const s = d.stats;
  const total = Math.max(s.total, 1);
  const cells: Array<{ label: string; value: string; tone: string; ratio: number | null }> = [
    { label: 'tests', value: String(s.total), tone: 'neutral', ratio: null },
    { label: 'passed', value: String(s.passed), tone: 'pass', ratio: s.passed / total },
    {
      label: 'failed',
      value: String(s.failed),
      tone: s.failed ? 'fail' : 'muted',
      ratio: s.failed / total,
    },
    { label: 'avg time', value: fmtDur(s.avgMs), tone: 'neutral', ratio: null },
    { label: 'steps', value: String(s.totalSteps), tone: 'neutral', ratio: null },
    { label: 'wall time', value: fmtDur(s.totalWall), tone: 'neutral', ratio: null },
  ];
  const statCells = cells
    .map((c) => {
      const pct = c.ratio == null ? null : Math.round(c.ratio * 100);
      const bar =
        pct == null
          ? '<span class="mstat-bar mstat-bar-static"></span>'
          : `<span class="mstat-bar"><span class="mstat-bar-fill" style="width:${pct}%"></span></span>`;
      return `<div class="mstat tone-${c.tone}">
        <div class="mstat-value">${esc(c.value)}</div>
        <div class="mstat-label">${esc(c.label)}</div>
        ${bar}
      </div>`;
    })
    .join('');

  return `<div class="hero-strip">
    <div class="hero-left">
      <div class="brand"><span class="brand-mark">◐</span> AppClaw<span class="brand-sub">history</span></div>
      <h1 class="suite">All Tests</h1>
      <div class="hero-meta">
        <span class="chip">${esc(runsLabel)}</span>
        ${latestChip}
        <span class="chip">avg ${esc(fmtDur(d.avgMs))}</span>
      </div>
    </div>
    <div class="hero-right">
      <div class="hero-mstats">${statCells}</div>
      <div class="hero-summary">
        <div class="donut" style="--dash:${dash.toFixed(1)};--circ:${C.toFixed(1)}">
          <svg viewBox="0 0 84 84">
            <circle class="donut-track" cx="42" cy="42" r="${R}"></circle>
            <circle class="donut-value" cx="42" cy="42" r="${R}"></circle>
          </svg>
          <div class="donut-center">
            <div class="rate">${d.passRate}<span>%</span></div>
          </div>
        </div>
        <div class="verdict verdict-${d.verdict.toLowerCase()}">
          <span class="dot"></span>${d.verdict}
          <span class="verdict-sub">${d.passed}/${d.runCount || d.passed}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function renderAnalytics(runs: RunIndexEntry[]): string {
  if (runs.length === 0) return '';
  const trend = computeTrendData(runs, 14);
  const sparkline = renderSparklineSvg(trend);

  const androidCount = runs.filter((r) => r.platform === 'android').length;
  const iosCount = runs.filter((r) => r.platform === 'ios').length;
  const totalPlat = androidCount + iosCount || 1;
  const androidPct = ((androidCount / totalPlat) * 100).toFixed(0);
  const iosPct = ((iosCount / totalPlat) * 100).toFixed(0);

  const failing = mostFailingTests(runs);
  const failingRows = failing
    .map((f) => {
      const pct = Math.max(6, Math.round((f.failures / f.total) * 100));
      return `<div class="failing-row">
        <div class="failing-name">${esc(f.name)}</div>
        <div class="failing-bar-wrap"><div class="failing-bar" style="width:${pct}%"></div></div>
        <span class="failing-count">${f.failures}/${f.total}</span>
      </div>`;
    })
    .join('');

  return `<div class="cockpit-rule"></div>
  <section class="analytics">
    <div class="ana-card ana-spark-card">
      <div class="ana-head">
        <span class="ana-label">14-day trend</span>
        <div class="ana-legend">
          <span class="ana-dot" style="background:var(--pass)"></span><span>Pass</span>
          <span class="ana-dot" style="background:var(--fail)"></span><span>Fail</span>
        </div>
      </div>
      <div class="ana-spark">${sparkline}</div>
    </div>
    <div class="ana-card">
      <div class="ana-label">Platform split</div>
      <div class="plat-labels">
        <span>${iconAndroid()} Android <strong>${androidPct}%</strong></span>
        <span>${iconApple()} iOS <strong>${iosPct}%</strong></span>
      </div>
      <div class="plat-bar" title="Android ${androidCount} · iOS ${iosCount}">
        <div class="plat-android" style="width:${androidPct}%"></div>
        <div class="plat-ios" style="width:${iosPct}%"></div>
      </div>
    </div>
    <div class="ana-card">
      <div class="ana-label">Most failing tests</div>
      ${
        failing.length === 0
          ? '<div class="ana-empty">No failures 🎉</div>'
          : `<div class="failing-list">${failingRows}</div>`
      }
    </div>
  </section>`;
}

function renderDevicesSidebar(runs: RunIndexEntry[]): string {
  if (runs.length === 0) return '';
  interface Bucket {
    name: string;
    platform: 'android' | 'ios';
    passed: number;
    failed: number;
    count: number;
    durationMs: number;
  }
  const byDev = new Map<string, Bucket>();
  for (const r of runs) {
    const name = r.device || '—';
    const key = `${r.platform}:${name}`;
    if (!byDev.has(key))
      byDev.set(key, {
        name,
        platform: r.platform,
        passed: 0,
        failed: 0,
        count: 0,
        durationMs: 0,
      });
    const b = byDev.get(key)!;
    b.count++;
    b.durationMs += r.durationMs || 0;
    if (r.success) b.passed++;
    else b.failed++;
  }
  const rows = [...byDev.values()]
    .sort((a, b) => b.count - a.count)
    .map((b) => {
      const passPct = b.count > 0 ? Math.round((b.passed / b.count) * 100) : 0;
      return `<div class="sidedev">
        <div class="sidedev-head">
          <span class="sidedev-plat">${b.platform === 'ios' ? iconApple() : iconAndroid()}</span>
          <span class="sidedev-name">${esc(b.name)}</span>
          <span class="sidedev-count">${b.count}</span>
        </div>
        <div class="sidedev-bar" title="${b.passed} passed · ${b.failed} failed">
          <span class="sidedev-bar-pass" style="width:${passPct}%"></span>
        </div>
        <div class="sidedev-stats">
          <span class="pass">${b.passed}✓</span>
          ${b.failed ? `<span class="fail">${b.failed}✗</span>` : '<span class="faint">0✗</span>'}
          <span class="faint sidedev-dur">${esc(fmtDur(b.durationMs))}</span>
        </div>
      </div>`;
    })
    .join('');
  return `<section class="dash-card">
    <h2 class="side-title">Devices <span class="count">${byDev.size}</span></h2>
    <div class="sidedev-list">${rows}</div>
  </section>`;
}

function testTitle(r: RunIndexEntry): string {
  // For SDK-driven runs `flowFile` is the stub `'sdk-run'`; only fall back to
  // it (or a filename tail) if there's no explicit test name recorded.
  if (r.flowName) return r.flowName;
  if (r.flowFile && r.flowFile !== 'sdk-run') {
    return r.flowFile.split('/').pop() || r.flowFile;
  }
  return r.runId;
}

function renderResults(runs: RunIndexEntry[], suites: SuiteEntry[]): string {
  const runById = new Map(runs.map((r) => [r.runId, r]));

  // Each suite renders as a single clickable row that links to its own page —
  // the self-contained HTML the runner already wrote. Cmd/Ctrl-click opens in a
  // new tab; the aggregate page stays a lightweight overview.
  const suiteRows = suites
    .map((s) => {
      const kids = s.runIds.map((id) => runById.get(id)).filter((r): r is RunIndexEntry => !!r);
      const total = kids.length;
      const failed = kids.filter((r) => !r.success).length;
      const name = s.suiteName || s.suiteId;
      const status = failed > 0 ? 'failed' : 'passed';
      const glyph = failed > 0 ? '✗' : '✓';
      const failLabel = failed > 0 ? `${failed} failed` : total === 0 ? 'no runs' : 'all passed';
      const badgeCls = failed > 0 ? 'has-fail' : 'all-pass';
      const searchable = `${name} ${s.suiteId}`;
      return `<a class="test suite-row status-${status}" href="/suites/${esc(s.suiteId)}"
         data-status="${status}"
         data-platform="${esc(s.platform)}"
         data-title="${esc(searchable.toLowerCase())}">
        <span class="status-glyph s-${status}">${glyph}</span>
        <span class="test-title">${esc(name)}</span>
        <span class="test-tags">
          <span class="tag ${badgeCls}">${failLabel}</span>
          <span class="tag tag-plat plat-${esc(s.platform)}">${s.platform === 'ios' ? iconApple() : iconAndroid()} ${esc(s.platform)}</span>
          <span class="tag tag-time">${esc(fmtDur(s.durationMs || 0))}</span>
          <span class="tag tag-when">${esc(fmtDateShort(s.startedAt))}</span>
        </span>
        <span class="chevron">›</span>
      </a>`;
    })
    .join('');
  const suiteGroups = suites.length
    ? `<div class="file-group">
        <div class="file-head">
          <span class="file-icon">›</span>
          <span class="file-path">Suites</span>
          <span class="file-badge all-pass">${suites.length} total</span>
          <span class="file-count">${suites.length}</span>
        </div>
        ${suiteRows}
      </div>`
    : '';

  return `<section class="results dash-card">
    <div class="results-head">
      <h2 class="section-title">Suites <span class="count" id="visible-count">${suites.length}</span></h2>
      <div class="controls">
        <input id="search" class="search" type="search" placeholder="filter suites…" autocomplete="off">
        <div class="filters" role="tablist">
          <button class="filter active" data-filter="all">All</button>
          <button class="filter" data-filter="failed">Failed</button>
          <button class="filter" data-filter="passed">Passed</button>
        </div>
        <div class="filters">
          <button class="filter-chip active" data-plat="all">All</button>
          <button class="filter-chip" data-plat="android">${iconAndroid()} Android</button>
          <button class="filter-chip" data-plat="ios">${iconApple()} iOS</button>
        </div>
        <button id="clear-filters" class="filter-clear" onclick="clearFilters()">Clear</button>
      </div>
    </div>
    <div id="groups">
      ${suiteGroups}
      ${
        suites.length === 0
          ? '<div class="empty">No suites yet — run your suite with the AppClaw runner to see results here.</div>'
          : ''
      }
    </div>
    <div id="empty" class="empty" hidden>No tests match.</div>
  </section>`;
}

function renderFooter(index: RunIndex): string {
  return `<footer class="footer reveal">
    <div class="footer-left">Generated by <strong>AppClaw</strong> · index <code>${esc(index.generatedAt)}</code></div>
    <div class="footer-right">history report</div>
  </footer>`;
}

/** Filter + auto-refresh script for the history page. */
function historyScript(): string {
  return `
// ── filter + search ──
var state={q:'',status:'all',plat:'all'};
function apply(){
  var visible=0;
  document.querySelectorAll('.test').forEach(function(t){
    var s=t.dataset.status||'', p=t.dataset.platform||'', title=t.dataset.title||'';
    var okS=state.status==='all'||s===state.status;
    var okP=state.plat==='all'||p===state.plat;
    var okQ=!state.q||title.indexOf(state.q)>-1;
    var show=okS&&okP&&okQ;
    t.style.display=show?'':'none'; if(show)visible++;
  });
  document.querySelectorAll('.file-group').forEach(function(g){
    var vis=[].some.call(g.querySelectorAll('.test'),function(t){return t.style.display!=='none';});
    g.style.display=vis?'':'none';
  });
  var c=document.getElementById('visible-count'); if(c)c.textContent=visible;
  var e=document.getElementById('empty'); if(e)e.hidden=visible!==0;
}
function clearFilters(){
  state={q:'',status:'all',plat:'all'};
  var s=document.getElementById('search'); if(s)s.value='';
  document.querySelectorAll('.filter').forEach(function(x){x.classList.toggle('active',x.dataset.filter==='all');});
  document.querySelectorAll('.filter-chip').forEach(function(x){x.classList.toggle('active',x.dataset.plat==='all');});
  apply();
}
document.querySelectorAll('.filter').forEach(function(b){
  b.addEventListener('click',function(){
    document.querySelectorAll('.filter').forEach(function(x){x.classList.remove('active');});
    b.classList.add('active'); state.status=b.dataset.filter; apply();
  });
});
document.querySelectorAll('.filter-chip').forEach(function(b){
  b.addEventListener('click',function(){
    document.querySelectorAll('.filter-chip').forEach(function(x){x.classList.remove('active');});
    b.classList.add('active'); state.plat=b.dataset.plat; apply();
  });
});
var sInp=document.getElementById('search');
if(sInp)sInp.addEventListener('input',function(){state.q=sInp.value.trim().toLowerCase();apply();});


// ── auto-refresh (server-mode only) ──
(function(){
  if(!/^https?:$/.test(location.protocol))return; // no polling for file:// previews
  var lastGen=(window.__INDEX__||{}).generatedAt||'';
  setInterval(function(){
    if(document.hidden)return;
    fetch('/api/runs').then(function(r){return r.ok?r.json():null;}).then(function(idx){
      if(!idx||!idx.generatedAt)return;
      if(idx.generatedAt!==lastGen){lastGen=idx.generatedAt; location.reload();}
    }).catch(function(){});
  },5000);
})();
`;
}

/* ═══════════════════════════════════════════════════════════════════
 * Mode C — per-run Step Inspector at `/runs/:runId`
 * ═══════════════════════════════════════════════════════════════════ */

interface ClientStep {
  n: number;
  kind: string;
  desc: string;
  status: string;
  durationMs: number;
  message?: string;
  phase?: string;
  img?: string;
  offsetMs?: number;
  tap?: { x: number; y: number; w?: number; h?: number };
}

function stepDescription(s: StepArtifact): string {
  return s.verbatim || s.target || s.message || s.kind;
}

function buildRunData(manifest: RunManifest): {
  runId: string;
  title: string;
  file: string;
  specFile?: string;
  device: string;
  os?: string;
  status: string;
  durationMs: number;
  error?: string;
  video?: string;
  mcpLog?: string;
  steps: ClientStep[];
} {
  const steps: ClientStep[] = (manifest.steps ?? []).map((s, i) => {
    const rel = s.beforeScreenshotPath ?? s.screenshotPath;
    const img = rel ? `/artifacts/${manifest.runId}/${rel}` : undefined;
    return {
      n: i + 1,
      kind: s.kind,
      desc: stepDescription(s),
      status: s.status,
      durationMs: s.durationMs,
      message: s.message,
      phase: s.phase,
      img,
      offsetMs: s.videoOffsetMs,
      tap: s.tapCoordinates
        ? {
            x: s.tapCoordinates.x,
            y: s.tapCoordinates.y,
            w: s.deviceScreenSize?.width ?? s.screenshotSize?.width,
            h: s.deviceScreenSize?.height ?? s.screenshotSize?.height,
          }
        : undefined,
    };
  });
  const video = manifest.videoPath
    ? `/artifacts/${manifest.runId}/${manifest.videoPath}`
    : undefined;
  const rawFile = manifest.flowFile;
  return {
    runId: manifest.runId,
    title:
      manifest.meta?.name ||
      (rawFile !== 'sdk-run' ? rawFile.split('/').pop() : undefined) ||
      manifest.runId,
    file: rawFile === 'sdk-run' ? '' : rawFile,
    specFile: manifest.specFile,
    device: manifest.device || '—',
    os: manifest.deviceVersion,
    status: manifest.success ? 'passed' : 'failed',
    durationMs: manifest.durationMs,
    error: manifest.reason,
    video,
    mcpLog: manifest.failureLogs?.appiumMcp,
    steps,
  };
}

export function renderRunPage(manifest: RunManifest): string {
  const data = buildRunData(manifest);
  const verdict = data.status === 'failed' ? 'FAILED' : 'PASSED';
  const passRate = data.status === 'passed' ? 100 : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = (passRate / 100) * C;
  const platIcon = manifest.platform === 'ios' ? iconApple() : iconAndroid();
  const failedStep = data.steps.find((s) => s.status === 'failed');
  const jumpToFail =
    failedStep && verdict === 'FAILED'
      ? `<a class="chip chip-fail" href="#step-${failedStep.n}" onclick="selectStep(${failedStep.n - 1});return false;">↓ jump to failure</a>`
      : '';

  const showFileChip = !!data.file;
  const specChip = data.specFile ? `<span class="chip chip-spec">${esc(data.specFile)}</span>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
${head(`${data.title} · AppClaw Test`)}
</head>
<body class="${verdict === 'FAILED' ? 'is-failed' : 'is-passed'}">
<div class="grain"></div>
${themeToggle()}
<main class="detail">
  <div class="dt-top">
    <a class="dt-back" href="/">← all tests</a>
    <span class="status-glyph s-${data.status}">${data.status === 'failed' ? '✗' : '✓'}</span>
    <h2 class="dt-title">${esc(data.title)}</h2>
    <span class="dt-verdict v-${data.status}">${data.status}</span>
  </div>
  <div class="dt-meta">
    <span class="chip plat plat-${esc(manifest.platform)}">${platIcon} ${esc(manifest.platform)}</span>
    <span class="chip">${esc(data.device)}${data.os ? ' · ' + esc(data.os) : ''}</span>
    <span class="chip">${esc(fmtDur(data.durationMs))}</span>
    <span class="chip">${esc(fmtDate(manifest.startedAt))}</span>
    ${specChip}
    ${showFileChip ? `<span class="chip">${esc(data.file)}</span>` : ''}
    ${data.video ? '<button class="chip dt-rec" id="dt-rec-btn" onclick="toggleVideo()">▶ recording</button>' : ''}
    <a class="chip" href="/api/runs/${esc(data.runId)}" download="${esc(data.runId)}.json">↓ JSON</a>
    ${jumpToFail}
  </div>
  ${data.error ? `<div class="error-box"><div class="error-label">Failure</div><pre class="error-msg">${esc(data.error)}</pre></div>` : ''}
  <div class="dt-grid">
    <div class="dt-panel">
      <div class="dt-steps-head"><span>Steps</span><span>${data.steps.length}</span></div>
      <div class="dt-steps" id="dt-steps">${renderStepListHTML(data.steps)}</div>
    </div>
    <div class="dt-stage">
      <div class="phone big">
        <div class="phone-screen">
          <img id="dt-img" alt="">
          <span id="dt-tap" class="tap" hidden></span>
          ${data.video ? '<video id="dt-video" class="dt-video" playsinline controls preload="metadata" hidden></video>' : ''}
        </div>
      </div>
    </div>
    <div class="dt-panel">
      <div class="dt-insp-head"><span>Inspector</span></div>
      <div class="dt-insp" id="dt-insp"></div>
    </div>
  </div>
  ${renderRunLogs(data)}
</main>
<script>${themeScript()}</script>
<script>window.__RUN__=${embedJson(data)};</script>
<script>${runScript()}</script>
</body>
</html>`;
}

function renderStepListHTML(steps: ClientStep[]): string {
  if (steps.length === 0)
    return '<div class="dt-noshot" style="padding:28px">No captured steps</div>';
  return steps
    .map(
      (
        s,
        i
      ) => `<button class="dt-step s-${s.status}" data-i="${i}" id="step-${s.n}" onclick="selectStep(${i})">
      <span class="dt-step-n">${s.n}</span>
      <span class="dt-step-main">
        <span class="dt-step-desc">${esc(s.desc)}</span>
        <span class="dt-step-kind">${esc(s.kind)}${s.phase ? ' · ' + esc(s.phase) : ''}</span>
      </span>
      <span class="dt-step-time">${esc(fmtDur(s.durationMs))}</span>
    </button>`
    )
    .join('');
}

function renderRunLogs(data: {
  status: string;
  steps: ClientStep[];
  error?: string;
  mcpLog?: string;
}): string {
  const show = data.status === 'failed' || !!data.mcpLog;
  if (!show) return '';
  const traceLines = data.steps.map((s) => {
    const mark = s.status === 'failed' ? '✗' : s.status === 'passed' ? '✓' : '•';
    const msg = s.message ? ` — ${s.message}` : '';
    return `${mark} #${s.n} ${s.kind}: ${s.desc}${msg}`;
  });
  if (data.error) {
    traceLines.push('');
    traceLines.push(`✗ ${data.error}`);
  }
  const trace = traceLines.join('\n');
  let blocks = `<details class="logblk" open><summary>AppClaw log</summary><pre class="logpre">${esc(trace)}</pre></details>`;
  if (data.mcpLog) {
    blocks += `<details class="logblk"><summary>appium-mcp server log <span class="logsub">(shared across workers)</span></summary><pre class="logpre">${esc(data.mcpLog)}</pre></details>`;
  }
  return `<section class="dt-logs"><div class="dt-logs-head">Logs</div>${blocks}</section>`;
}

function runScript(): string {
  return `
var DATA=window.__RUN__||{steps:[]};
var curStep=0, videoMode=false;

function highlightStep(i){
  document.querySelectorAll('.dt-step').forEach(function(b){b.classList.toggle('active',+b.dataset.i===i);});
  var act=document.querySelector('.dt-step[data-i="'+i+'"]'); if(act)act.scrollIntoView({block:'nearest'});
}
function placeTap(t){
  var img=document.getElementById('dt-img'), tap=document.getElementById('dt-tap'), scr=img.parentElement;
  var w=t.w||img.naturalWidth, h=t.h||img.naturalHeight;
  if(!w||!h){tap.hidden=true;return;}
  scr.style.aspectRatio=(img.naturalWidth||w)+'/'+(img.naturalHeight||h);
  tap.style.left=(t.x/w*100)+'%'; tap.style.top=(t.y/h*100)+'%'; tap.hidden=false;
}
function renderInspector(s){
  var rows=[['Instruction',esc(s.desc),'']];
  rows.push(['Status','<span class="insp-pill s-'+s.status+'">'+s.status+'</span>','raw']);
  rows.push(['Action',esc(s.kind),'mono']);
  if(s.phase)rows.push(['Phase',esc(s.phase),'mono']);
  rows.push(['Duration',fmt(s.durationMs),'mono']);
  if(s.message)rows.push(['Message',esc(s.message),'']);
  if(s.tap)rows.push(['Tap point','['+s.tap.x+', '+s.tap.y+']','mono']);
  document.getElementById('dt-insp').innerHTML=rows.map(function(r){
    var body=r[2]==='raw'?r[1]:'<div class="insp-val'+(r[2]==='mono'?' mono':'')+'">'+r[1]+'</div>';
    return '<div class="insp-row"><div class="insp-label">'+r[0]+'</div>'+body+'</div>';
  }).join('');
}
function videoTimeToStep(cur,dur){
  if(!dur||!isFinite(dur)||!DATA.durationMs)return curStep;
  var wall=(cur/dur)*DATA.durationMs, idx=0;
  for(var k=0;k<DATA.steps.length;k++){ if((DATA.steps[k].offsetMs||0)<=wall) idx=k; }
  return idx;
}
function stepToVideoTime(s,dur){
  if(!dur||!isFinite(dur)||!DATA.durationMs)return 0;
  return Math.max(0,Math.min(dur,((s.offsetMs||0)/DATA.durationMs)*dur));
}
function selectStep(i){
  var s=DATA.steps[i]; if(!s)return;
  curStep=i;
  highlightStep(i); renderInspector(s);
  if(location.hash!=='#step-'+s.n) history.replaceState(null,'','#step-'+s.n);
  if(videoMode){
    var vid=document.getElementById('dt-video');
    if(vid) vid.currentTime=stepToVideoTime(s,vid.duration);
    return;
  }
  var img=document.getElementById('dt-img'), tap=document.getElementById('dt-tap');
  tap.hidden=true;
  img.onload=function(){ if(curStep===i&&!videoMode&&s.tap) placeTap(s.tap); };
  if(s.img){img.style.display='';img.src=s.img;}else{img.removeAttribute('src');img.style.display='none';}
  if(s.img&&img.complete&&img.naturalWidth&&s.tap) placeTap(s.tap);
}
function toggleVideo(){
  if(!DATA.video)return;
  var vid=document.getElementById('dt-video'), img=document.getElementById('dt-img'),
      tap=document.getElementById('dt-tap'), btn=document.getElementById('dt-rec-btn');
  videoMode=!videoMode;
  if(videoMode){
    if(!vid.getAttribute('src')) vid.src=DATA.video;
    img.style.display='none'; tap.hidden=true; vid.hidden=false;
    if(btn)btn.classList.add('on');
    vid.parentElement.style.aspectRatio='9/19.5';
    vid.ontimeupdate=function(){
      var idx=videoTimeToStep(vid.currentTime,vid.duration);
      if(idx!==curStep){ curStep=idx; highlightStep(idx); renderInspector(DATA.steps[idx]); }
    };
    vid.play().catch(function(){});
  }else{
    vid.pause(); vid.hidden=true; img.style.display='';
    if(btn)btn.classList.remove('on');
    selectStep(curStep);
  }
}
document.addEventListener('keydown',function(e){
  if(!DATA.steps.length)return;
  if(e.key==='Escape'){location.href='/';return;}
  if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();if(curStep<DATA.steps.length-1)selectStep(curStep+1);}
  else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();if(curStep>0)selectStep(curStep-1);}
});
(function(){
  if(!DATA.steps.length)return;
  var m=(location.hash||'').match(/^#step-(\\d+)$/);
  var initial=0;
  if(m){var n=+m[1]-1; if(n>=0&&n<DATA.steps.length) initial=n;}
  selectStep(initial);
})();
`;
}

/* ─── shared JSON embed ─────────────────────────────────────────── */

function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/* ═══════════════════════════════════════════════════════════════════
 * styles — mirrors src/runner/suite-report.ts palette + adds bits
 * needed only in server mode (analytics cards, platform chips,
 * clear-filters button, standalone-group heading).
 * ═══════════════════════════════════════════════════════════════════ */

function styles(): string {
  return `
:root{
  --bg:#0b0e13; --panel:#161a22; --panel-2:#1b2029; --line:#272d37;
  --ink:#e6eaf1; --muted:#919aab; --faint:#5b6473;
  --brand:#19d4ec; --brand-soft:rgba(25,212,236,.14); --brand-rgb:25,212,236;
  --pass:#3ddc97; --fail:#f0596a; --skip:#6b7280; --flaky:#f0b429;
  --r:16px;
}
/* pre-body class flip (so light-mode users don't flash dark first) */
html.preload-light body{background:#f3f6f8;color:#15202c}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;background:
    radial-gradient(1100px 520px at 82% -8%, rgba(25,212,236,.10), transparent 60%),
    radial-gradient(900px 600px at -5% 0%, rgba(99,102,241,.07), transparent 55%),
    var(--bg);
  color:var(--ink);
  font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
  font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;
  min-height:100vh;
}
body.is-failed{--brand:var(--fail);--brand-soft:rgba(240,89,106,.14);--brand-rgb:240,89,106}
.grain{position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
main{position:relative;z-index:1;max-width:1560px;margin:0 auto;padding:40px 32px 80px}
code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.85em}

.reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards}
.cockpit{animation-delay:0s}.dash-body{animation-delay:.12s}.results{animation-delay:.18s}.footer{animation-delay:.24s}
@keyframes rise{to{opacity:1;transform:none}}

body.light{
  --bg:#f3f6f8; --panel:#ffffff; --panel-2:#eef2f6; --line:#dce2ea;
  --ink:#15202c; --muted:#5c6675; --faint:#97a1ae;
  --brand:#0a97ad; --brand-soft:rgba(10,151,173,.12); --brand-rgb:10,151,173;
  --pass:#13a06a; --fail:#e0485f; --skip:#8a909c; --flaky:#c08400;
  background:radial-gradient(1100px 520px at 82% -8%, rgba(10,151,173,.07), transparent 60%),#f3f6f8;
  color:var(--ink);
}
body.light.is-failed{--brand:#e0485f;--brand-soft:rgba(224,72,95,.1);--brand-rgb:224,72,95}
body.light .grain{opacity:.015}
body.light .suite{background:linear-gradient(180deg,#13161d,#454c5a);-webkit-background-clip:text;background-clip:text}
body.light .donut-track{stroke:rgba(0,0,0,.08)}
body.light .cockpit{box-shadow:0 24px 60px -42px rgba(20,30,60,.3)}
body.light .chip{background:rgba(0,0,0,.02)}

.theme-toggle{position:fixed;top:18px;right:18px;z-index:40;width:40px;height:40px;border-radius:11px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:17px;cursor:pointer;
  display:grid;place-items:center;transition:.15s;box-shadow:0 6px 18px -10px rgba(0,0,0,.5)}
.theme-toggle:hover{border-color:var(--brand);color:var(--brand)}

/* ── cockpit: hero + mini-stats + analytics fused into one dense strip ── */
.cockpit{border:1px solid var(--line);border-radius:22px;overflow:hidden;position:relative;
  background:linear-gradient(160deg,var(--panel-2),var(--panel));
  box-shadow:0 30px 80px -40px rgba(0,0,0,.8)}
.cockpit::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(var(--brand-rgb),.55),transparent);opacity:.75}
.cockpit::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,rgba(var(--brand-rgb),.06),transparent 40%);opacity:.9}
.cockpit-rule{height:1px;background:var(--line);opacity:.55;margin:0 24px}

/* hero row inside the cockpit — 3 columns: title │ mini-stats │ donut+verdict */
.hero-strip{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:26px;align-items:stretch;
  padding:22px 26px 20px;position:relative;z-index:1}
.hero-left{min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:10px}
.brand{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
.brand-mark{color:var(--brand);font-size:14px}
.brand-sub{color:var(--faint)}
.suite{font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;
  font-size:clamp(28px,3vw,40px);line-height:1.05;letter-spacing:-.02em;margin:8px 0 12px;
  background:linear-gradient(180deg,#fff,#c8cbd6);-webkit-background-clip:text;background-clip:text;color:transparent;
  overflow-wrap:anywhere}
.hero-meta{display:flex;flex-wrap:wrap;gap:7px}
.chip{font-family:"JetBrains Mono",monospace;font-size:12.5px;padding:4px 11px;border-radius:999px;
  border:1px solid var(--line);background:rgba(255,255,255,.02);color:var(--muted);text-decoration:none}
.chip.plat{text-transform:uppercase;letter-spacing:.06em;color:var(--ink);border-color:var(--brand);background:var(--brand-soft);display:inline-flex;align-items:center;gap:6px}
.chip.plat svg{width:12px;height:12px}
.chip.chip-fail{color:var(--fail);border-color:rgba(240,89,106,.4)}
.chip.chip-spec{color:var(--brand);border-color:rgba(var(--brand-rgb),.35);background:var(--brand-soft)}

.hero-right{display:flex;align-items:stretch;gap:18px;flex-shrink:0;border-left:1px solid var(--line);padding-left:18px}

/* mini-stats: 3×2 grid of gauge cells */
.hero-mstats{display:grid;grid-template-columns:repeat(3,minmax(88px,1fr));align-items:center}
.mstat{position:relative;padding:6px 14px;border-right:1px solid var(--line)}
.hero-mstats > .mstat:nth-child(3n){border-right:none}
.hero-mstats > .mstat:nth-child(-n+3){border-bottom:1px solid var(--line);padding-bottom:10px}
.hero-mstats > .mstat:nth-child(n+4){padding-top:10px}
.mstat-value{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:22px;line-height:1;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink)}
.mstat-label{font-family:"JetBrains Mono",monospace;font-size:10.5px;text-transform:uppercase;
  letter-spacing:.16em;color:var(--muted);margin-top:7px}
.mstat-bar{display:block;margin-top:8px;height:2px;background:rgba(255,255,255,.05);border-radius:1px;position:relative;overflow:hidden}
.mstat-bar-fill{position:absolute;left:0;top:0;bottom:0;background:var(--bar,var(--faint));border-radius:1px;
  transform-origin:left;animation:barGrow .9s cubic-bezier(.3,.8,.3,1) .3s both}
.mstat-bar-static{background:linear-gradient(90deg,rgba(255,255,255,.06),transparent)}
@keyframes barGrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.mstat.tone-pass{--bar:var(--pass)}.mstat.tone-pass .mstat-value{color:var(--pass)}
.mstat.tone-fail{--bar:var(--fail)}.mstat.tone-fail .mstat-value{color:var(--fail)}
.mstat.tone-flaky{--bar:var(--flaky)}.mstat.tone-flaky .mstat-value{color:var(--flaky)}
.mstat.tone-skip{--bar:var(--skip)}.mstat.tone-skip .mstat-value{color:var(--skip)}
.mstat.tone-neutral{--bar:rgba(var(--brand-rgb),.65)}
.mstat.tone-muted{--bar:var(--faint)}
.mstat.tone-muted .mstat-value{color:var(--faint)}
.mstat.tone-muted .mstat-bar-fill{opacity:.35}

/* donut + verdict pinned to the far right */
.hero-summary{display:flex;flex-direction:column;align-items:center;gap:10px;flex-shrink:0;border-left:1px solid var(--line);padding-left:18px;justify-content:center}
.donut{position:relative;width:84px;height:84px}
.donut svg{transform:rotate(-90deg);width:84px;height:84px}
.donut circle{fill:none;stroke-width:8;stroke-linecap:round}
.donut-track{stroke:rgba(255,255,255,.06)}
.donut-value{stroke:var(--pass);stroke-dasharray:var(--circ);stroke-dashoffset:var(--circ);
  animation:draw 1.1s cubic-bezier(.3,.8,.3,1) .25s forwards}
body.is-failed .donut-value{stroke:var(--fail)}
@keyframes draw{to{stroke-dashoffset:calc(var(--circ) - var(--dash))}}
.donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.rate{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:20px;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rate span{font-size:11px;color:var(--muted);margin-left:1px}
.rate-label{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-top:2px}
.verdict{display:inline-flex;align-items:center;gap:7px;font-family:"JetBrains Mono",monospace;
  font-weight:700;font-size:12.5px;letter-spacing:.14em;padding:5px 12px;border-radius:9px;border:1px solid var(--line);text-transform:uppercase}
.verdict .dot{width:7px;height:7px;border-radius:50%}
.verdict-sub{font-size:11.5px;font-weight:500;color:var(--muted);letter-spacing:.02em}
.verdict-passed{color:var(--pass);border-color:rgba(61,220,151,.35)}.verdict-passed .dot{background:var(--pass);box-shadow:0 0 10px var(--pass)}
.verdict-failed{color:var(--fail);border-color:rgba(240,89,106,.35)}.verdict-failed .dot{background:var(--fail);box-shadow:0 0 10px var(--fail)}
.verdict-empty{color:var(--muted)}.verdict-empty .dot{background:var(--muted)}

/* analytics — sits inside the cockpit, below the hero-strip */
.analytics{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:0;padding:14px 24px 18px;position:relative;z-index:1}
.ana-card{padding:6px 20px;position:relative;border-right:1px solid var(--line)}
.ana-card:last-child{border-right:none;padding-right:6px}
.ana-card:first-child{padding-left:6px}
.ana-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.ana-label{font-family:"JetBrains Mono",monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.16em;color:var(--muted);font-weight:600;margin-bottom:10px;display:block}
.ana-legend{display:flex;gap:10px;font-size:11.5px;color:var(--muted)}
.ana-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle}
.ana-spark{width:100%}
.ana-empty{padding:12px 4px;color:var(--faint);font-size:13px}
.plat-labels{display:flex;justify-content:space-between;align-items:center;font-size:13.5px;color:var(--muted);margin-bottom:10px}
.plat-labels svg{vertical-align:middle;margin-right:4px}
.plat-labels strong{color:var(--ink);margin-left:4px}
.plat-bar{height:8px;border-radius:999px;overflow:hidden;background:var(--panel-2);display:flex}
.plat-bar > .plat-android{background:var(--brand);height:100%}
.plat-bar > .plat-ios{background:rgba(var(--brand-rgb),.45);height:100%}
.failing-list{display:flex;flex-direction:column;gap:8px}
.failing-row{display:grid;grid-template-columns:1fr 60px auto;gap:8px;align-items:center}
.failing-name{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.failing-bar-wrap{height:7px;border-radius:999px;background:var(--panel-2);overflow:hidden}
.failing-bar{height:100%;background:var(--fail);opacity:.85;border-radius:999px}
.failing-count{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--muted)}

/* ── dashboard body: sidebar + main results ── */
.dash-body{display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px;margin-top:22px;align-items:start}
.dash-side{position:sticky;top:20px}
.dash-main{min-width:0}
.dash-card{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:18px 20px;position:relative;overflow:hidden}
.dash-card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--brand);opacity:.55}
.side-title{font-family:"Plus Jakarta Sans",sans-serif;font-weight:700;font-size:15px;
  margin:0 0 14px;display:flex;align-items:center;gap:8px;padding-left:6px}
.side-title .count{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.sidedev-list{display:flex;flex-direction:column;gap:12px;padding-left:6px}
.sidedev{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--line);
  border-radius:11px;background:rgba(255,255,255,.015)}
.sidedev-head{display:flex;align-items:center;gap:8px}
.sidedev-plat{color:var(--muted);display:inline-flex}
.sidedev-plat svg{width:12px;height:12px}
.sidedev-name{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;color:var(--ink);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidedev-count{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.sidedev-bar{height:3px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden}
.sidedev-bar-pass{display:block;height:100%;background:var(--pass);border-radius:2px;
  transform-origin:left;animation:barGrow .8s cubic-bezier(.3,.8,.3,1) .35s both}
.sidedev-stats{display:flex;align-items:center;gap:10px;font-family:"JetBrains Mono",monospace;font-size:11.5px}
.sidedev-stats .pass{color:var(--pass);font-weight:600}
.sidedev-stats .fail{color:var(--fail);font-weight:600}
.sidedev-dur{margin-left:auto}

/* section titles used inside the main pane */
.section-title{font-family:"Plus Jakarta Sans",sans-serif;font-weight:700;font-size:20px;
  margin:0 0 16px;display:flex;align-items:center;gap:10px}
.section-title .count,.file-count{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.devices{margin-top:36px}
.device-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.device-card{display:flex;gap:12px;align-items:center;border:1px solid var(--line);border-radius:14px;
  padding:12px 14px;background:var(--panel)}
.device-frame-mini{width:26px;height:44px;border-radius:6px;border:2px solid var(--faint);flex-shrink:0;position:relative;
  background:linear-gradient(160deg,#222838,#11141c)}
.device-frame-mini::after{content:"";position:absolute;left:50%;top:4px;transform:translateX(-50%);width:8px;height:2px;border-radius:2px;background:var(--faint)}
.device-name{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}
.device-os{color:var(--muted);font-weight:500;font-size:11px}
.device-os svg{vertical-align:middle}
.device-stats{display:flex;gap:10px;font-size:12px;margin-top:3px}
.device-stats .pass{color:var(--pass)}.device-stats .fail{color:var(--fail)}.faint{color:var(--faint)}

/* results */
.results-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.results-head .section-title{margin:0}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search{font-family:"JetBrains Mono",monospace;font-size:13px;background:var(--panel);border:1px solid var(--line);
  color:var(--ink);padding:8px 13px;border-radius:10px;width:190px;outline:none}
.search:focus{border-color:var(--brand)}
.filters{display:flex;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:3px}
.filter,.filter-chip{font-family:"Inter",sans-serif;font-size:13px;font-weight:500;color:var(--muted);background:none;
  border:none;padding:6px 13px;border-radius:7px;cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:5px}
.filter:hover,.filter-chip:hover{color:var(--ink)}
.filter.active,.filter-chip.active{background:var(--brand);color:#04222a;font-weight:600}
.filter-chip svg{width:12px;height:12px}
.filter-clear{font-family:"Inter",sans-serif;font-size:12.5px;color:var(--muted);background:var(--panel);
  border:1px solid var(--line);border-radius:10px;padding:7px 12px;cursor:pointer;transition:.15s}
.filter-clear:hover{color:var(--ink);border-color:var(--brand)}

.file-group{margin-bottom:20px}
.file-head{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--line);margin-bottom:8px;user-select:none}
.file-icon{color:var(--brand);display:inline-block}
.file-path{font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--ink);font-weight:500}
.file-badge{font-size:11px;padding:2px 9px;border-radius:999px;font-weight:600}
.file-badge.all-pass{color:var(--pass);background:rgba(61,220,151,.1)}
.file-badge.has-fail{color:var(--fail);background:rgba(240,89,106,.1)}
.file-count{margin-left:auto}

.test{width:100%;display:flex;align-items:center;gap:13px;padding:14px 16px;text-align:left;
  border:1px solid var(--line);border-radius:13px;background:var(--panel);margin-bottom:8px;cursor:pointer;
  color:var(--ink);font-family:inherit;font-size:14.5px;transition:border-color .2s,transform .12s,background .2s;text-decoration:none}
.test.status-failed{border-color:rgba(240,89,106,.35)}
.test:hover{border-color:var(--brand);background:var(--panel-2);transform:translateX(2px)}
.status-glyph{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:12px;flex-shrink:0;font-weight:700}
.s-passed{background:rgba(61,220,151,.16);color:var(--pass)}
.s-failed{background:rgba(240,89,106,.16);color:var(--fail)}
.s-skipped{background:rgba(107,114,128,.16);color:var(--skip)}
.test-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.test-tags{display:flex;gap:6px;align-items:center;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}
.tag{font-family:"JetBrains Mono",monospace;font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--line);color:var(--muted);white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
.tag svg{width:11px;height:11px}
.tag-device{color:var(--ink)}
.tag-plat{text-transform:uppercase;letter-spacing:.05em}
.tag-time{color:var(--brand);border-color:rgba(var(--brand-rgb),.3)}
.tag-when{color:var(--faint)}
.tag.all-pass{color:var(--pass);border-color:rgba(61,220,151,.3)}
.tag.has-fail{color:var(--fail);border-color:rgba(240,89,106,.35)}
.suite-row .test-title{font-weight:600}
.chevron{color:var(--faint);font-size:20px;transition:transform .15s,color .15s}
.test:hover .chevron{color:var(--brand);transform:translateX(3px)}

.error-box{border:1px solid rgba(240,89,106,.3);border-radius:10px;background:rgba(240,89,106,.06);padding:12px 14px;margin:8px 0 14px}
.error-label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--fail);font-weight:600;margin-bottom:6px}
.error-msg{font-family:"JetBrains Mono",monospace;font-size:12.5px;color:#ffd2d9;margin:0;white-space:pre-wrap;word-break:break-word}
body.light .error-msg{color:#7a1a2a}

/* phone frame */
.phone{display:block;padding:6px;border-radius:18px;background:linear-gradient(160deg,#262d3e,#0f121a);
  border:1px solid #313a4f;box-shadow:0 14px 30px -16px rgba(0,0,0,.9)}
.phone-screen{position:relative;display:block;border-radius:13px;overflow:hidden;background:#000;aspect-ratio:9/19.5}
.phone-screen img{width:100%;height:100%;object-fit:cover;display:block}
.tap{position:absolute;width:26px;height:26px;border-radius:50%;transform:translate(-50%,-50%);
  border:2px solid var(--brand);background:rgba(var(--brand-rgb),.25);box-shadow:0 0 0 0 rgba(var(--brand-rgb),.5);
  animation:tap 1.8s ease-out infinite;pointer-events:none}
@keyframes tap{0%{box-shadow:0 0 0 0 rgba(var(--brand-rgb),.5)}70%{box-shadow:0 0 0 16px rgba(var(--brand-rgb),0)}100%{box-shadow:0 0 0 0 rgba(var(--brand-rgb),0)}}

/* detail view (per-run Step Inspector) */
.detail{max-width:1280px}
.dt-top{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-bottom:8px}
.dt-back{font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--muted);background:var(--panel);
  border:1px solid var(--line);border-radius:9px;padding:8px 14px;cursor:pointer;transition:.15s;text-decoration:none}
.dt-back:hover{color:var(--ink);border-color:var(--brand)}
.dt-title{font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;font-size:clamp(22px,3vw,32px);
  letter-spacing:-.01em;margin:0;flex:1;min-width:200px}
.dt-verdict{font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;letter-spacing:.04em;font-size:15px;
  padding:6px 14px;border-radius:10px;border:1px solid var(--line);text-transform:uppercase}
.dt-verdict.v-passed{color:var(--pass);border-color:rgba(61,220,151,.4)}
.dt-verdict.v-failed{color:var(--fail);border-color:rgba(240,89,106,.4)}
.dt-verdict.v-skipped{color:var(--skip)}
.dt-meta{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 18px}
.dt-rec{color:var(--brand);cursor:pointer;font-family:inherit;border-color:rgba(var(--brand-rgb),.35)!important}
.dt-rec:hover{background:var(--brand-soft)}
.dt-rec.on{background:var(--brand);color:#04222a;border-color:var(--brand)!important}
.dt-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;background:#000}
.dt-video[hidden]{display:none}

.dt-logs{margin-top:20px}
.dt-logs-head{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:10px}
.logblk{border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-bottom:10px;overflow:hidden}
.logblk>summary{cursor:pointer;padding:11px 14px;font-size:13px;font-weight:600;list-style:none;user-select:none}
.logblk>summary::-webkit-details-marker{display:none}
.logblk>summary::before{content:'▸';display:inline-block;margin-right:8px;color:var(--faint);transition:transform .15s}
.logblk[open]>summary::before{transform:rotate(90deg)}
.logsub{font-weight:400;color:var(--faint);font-size:11px}
.logpre{margin:0;padding:14px;border-top:1px solid var(--line);background:var(--bg);font-family:"JetBrains Mono",monospace;font-size:12px;line-height:1.55;color:var(--muted);white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto}

.dt-grid{display:grid;grid-template-columns:300px 1fr 320px;gap:20px;align-items:start}
.dt-panel{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
.dt-steps-head,.dt-insp-head{font-family:"JetBrains Mono",monospace;font-size:11px;text-transform:uppercase;
  letter-spacing:.12em;color:var(--muted);padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.dt-steps{padding:6px;max-height:74vh;overflow:auto}
.dt-step{display:flex;align-items:center;gap:11px;width:100%;text-align:left;padding:11px 12px;border:1px solid transparent;
  border-radius:10px;background:none;color:var(--ink);cursor:pointer;font-family:inherit;font-size:13.5px;transition:.12s}
.dt-step:hover{background:var(--panel-2)}
.dt-step.active{background:rgba(var(--brand-rgb),.1);border-color:rgba(var(--brand-rgb),.4)}
.dt-step-n{width:24px;height:24px;border-radius:7px;flex-shrink:0;display:grid;place-items:center;font-size:11px;font-weight:700;
  font-family:"JetBrains Mono",monospace;background:var(--panel-2);border:1px solid var(--line);color:var(--muted)}
.dt-step.s-passed .dt-step-n{color:var(--pass);border-color:rgba(61,220,151,.4)}
.dt-step.s-failed .dt-step-n{color:var(--fail);border-color:rgba(240,89,106,.5)}
.dt-step-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dt-step-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.dt-step-kind{font-family:"JetBrains Mono",monospace;font-size:10px;text-transform:uppercase;color:var(--faint);margin-top:2px}
.dt-step-time{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--faint);flex-shrink:0}

.dt-stage{display:flex;justify-content:center;padding:8px}
.phone.big{padding:9px;border-radius:30px}
.phone.big .phone-screen{border-radius:22px;height:min(72vh,660px);aspect-ratio:9/19.5}
.phone.big .phone-screen img{object-fit:contain}

.dt-insp{padding:6px 4px}
.insp-row{padding:13px 16px;border-bottom:1px solid var(--line)}
.insp-row:last-child{border-bottom:none}
.insp-label{font-family:"JetBrains Mono",monospace;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin-bottom:6px}
.insp-val{font-size:14px;color:var(--ink);word-break:break-word;line-height:1.45}
.insp-val.mono{font-family:"JetBrains Mono",monospace;font-size:13px}
.insp-pill{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:11px;text-transform:uppercase;letter-spacing:.06em;
  padding:3px 10px;border-radius:6px;border:1px solid var(--line)}
.insp-pill.s-passed{color:var(--pass);border-color:rgba(61,220,151,.4)}
.insp-pill.s-failed{color:var(--fail);border-color:rgba(240,89,106,.4)}
.dt-noshot{display:grid;place-items:center;height:100%;color:var(--faint);font-style:italic}
@media(max-width:960px){.dt-grid{grid-template-columns:1fr}.phone.big .phone-screen{height:auto;max-height:70vh}}

.empty{text-align:center;color:var(--faint);padding:50px;font-style:italic}

.footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);display:flex;
  justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}
.footer code{color:var(--faint)}
.footer strong{color:var(--brand);font-weight:600}

@media(max-width:1200px){
  .dash-body{grid-template-columns:1fr}
  .dash-side{position:static}
  .hero-strip{grid-template-columns:1fr;gap:16px}
  .hero-right{border-left:none;padding-left:0;padding-top:16px;border-top:1px solid var(--line);align-items:center;justify-content:space-between}
  .hero-mstats{flex:1}
  .analytics{grid-template-columns:1fr;gap:16px 0;padding:14px 22px 18px}
  .ana-card{border-right:none;padding:12px 6px;border-bottom:1px solid var(--line)}
  .ana-card:last-child{border-bottom:none}
}
@media(max-width:720px){
  .hero-right{flex-direction:column;align-items:stretch}
  .hero-summary{border-left:none;padding-left:0;border-top:1px solid var(--line);padding-top:10px;flex-direction:row;justify-content:space-between}
  .hero-mstats{grid-template-columns:repeat(3,1fr)}
}
`;
}
