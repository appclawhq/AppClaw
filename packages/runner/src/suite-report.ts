/**
 * Standalone suite report — one self-contained HTML file per runner invocation.
 *
 * Unlike the global `--report` viewer (which indexes *every* historical run),
 * this report is scoped to the CURRENT run only. It aggregates the suite's
 * tests, links each back to its on-disk manifest (steps + screenshots + video)
 * via `runId`, and renders a mobile-focused report: per-device breakdown,
 * per-file grouping, a step timeline with device-framed screenshots (click any
 * to zoom into a full-size lightbox), failure reasons, and the run environment.
 *
 * Written to `.appclaw/runs/<suiteId>/index.html`; screenshots are referenced
 * relatively (`../<runId>/steps/…`) so the folder is portable.
 */

import * as path from 'node:path';
import { promises as fsp } from 'node:fs';
import { loadRunManifest } from '@appclaw/core/report/writer';
import type { Platform } from '@appclaw/core/sdk/types';
import type { StepArtifact, HookRecord } from '@appclaw/core/report/types';
import type { SuiteResult, TestResult } from './types.js';

export interface SuiteReportMeta {
  suiteId: string;
  suiteName: string;
  platform: Platform;
  startedAt: string;
  devices: { name: string; platform?: Platform }[];
  workers: number;
  provider?: string;
  model?: string;
}

interface ReportTest {
  title: string;
  file: string;
  device: string;
  /** Device OS version ("Android 14" / "iOS 17.2"), from the run manifest. */
  osVersion?: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  retries: number;
  error?: string;
  runId?: string;
  steps: ReportStep[];
  /** Runner-lifecycle hooks that fired around this test (deviceSetup, beforeAll, beforeEach, afterEach). */
  hooks?: HookRecord[];
  /** appium-mcp server log tail captured at failure time (failed tests only). */
  appiumMcpLog?: string;
  /** Screen recording inlined as a base64 data URI (so the report is portable). */
  videoData?: string;
  /** Stable index assigned at render time; links a list row to its detail data. */
  id?: number;
}

/** A step plus its screenshot as a data URI (read straight from the manifest). */
type ReportStep = StepArtifact & { img?: string };

/* ───────────────────────── data assembly ───────────────────────── */

/** Read a file and return a base64 data URI, or undefined if absent. */
async function fileToDataUri(absPath: string, mime: string): Promise<string | undefined> {
  try {
    const buf = await fsp.readFile(absPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Load each test's manifest (steps/screenshots/video) and shape the model. */
async function assembleTests(projectRoot: string, results: TestResult[]): Promise<ReportTest[]> {
  return Promise.all(
    results.map(async (r) => {
      const base: ReportTest = {
        title: r.title,
        file: relFile(projectRoot, r.file),
        device: r.device?.name ?? '—',
        status: r.status,
        durationMs: r.durationMs,
        retries: r.retries,
        error: r.error,
        runId: r.runId,
        steps: [],
      };
      if (!r.runId) return base;
      const manifest = await loadRunManifest(projectRoot, r.runId).catch(() => null);
      if (manifest) {
        base.osVersion = manifest.deviceVersion;
        base.appiumMcpLog = manifest.failureLogs?.appiumMcp;
        base.hooks = manifest.hooks;
        // Screenshots are base64 in the manifest, so the report stays a single
        // portable file with no external requests. Prefer the before/tap-surface
        // screenshot when present (tap steps) so the dot lands on the screen the
        // tap happened on; fall back to the after-execution screenshot otherwise.
        base.steps = (manifest.steps ?? []).map((s) => ({
          ...s,
          img: s.beforeScreenshot ?? s.screenshot,
        }));
        // Inline the recording too (base64) so the report stays one portable
        // file — plays in place, like the screenshots.
        if (manifest.videoPath) {
          base.videoData = await fileToDataUri(
            path.join(projectRoot, '.appclaw', 'runs', r.runId, manifest.videoPath),
            'video/mp4'
          );
        }
        // Manifest duration is more precise for passed tests with sub-steps.
        if (!base.durationMs && manifest.durationMs) base.durationMs = manifest.durationMs;
      }
      return base;
    })
  );
}

function relFile(projectRoot: string, file?: string): string {
  if (!file) return '(no file)';
  return file.startsWith(projectRoot) ? file.slice(projectRoot.length).replace(/^[/\\]/, '') : file;
}

/**
 * Build + write the report. Returns the absolute path to the HTML, or null if
 * generation failed (non-fatal — a missing report must never fail the run).
 */
export async function generateSuiteReport(
  projectRoot: string,
  suite: SuiteResult,
  meta: SuiteReportMeta
): Promise<string | null> {
  try {
    const tests = await assembleTests(projectRoot, suite.results);
    const html = renderReport(suite, meta, tests);
    const dir = path.join(projectRoot, '.appclaw', 'runs', meta.suiteId);
    await fsp.mkdir(dir, { recursive: true });
    const out = path.join(dir, 'index.html');
    await fsp.writeFile(out, html, 'utf-8');
    return out;
  } catch {
    return null;
  }
}

/* ───────────────────────── formatting helpers ──────────────────── */

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

/* ───────────────────────── rendering ───────────────────────────── */

function renderReport(suite: SuiteResult, meta: SuiteReportMeta, tests: ReportTest[]): string {
  // Derive counts from `tests` so a partially-populated suite object can never
  // surface as NaN/undefined in the header cards. Prefer suite's own tallies
  // when present, else fall back to what the test list tells us.
  const passed = suite.passed ?? tests.filter((t) => t.status === 'passed').length;
  const failed = suite.failed ?? tests.filter((t) => t.status === 'failed').length;
  const skipped = suite.skipped ?? tests.filter((t) => t.status === 'skipped').length;
  const total = passed + failed + skipped;
  const ran = passed + failed;
  const passRate = ran > 0 ? Math.round((passed / ran) * 100) : 100;
  const flaky = tests.filter((t) => t.status === 'passed' && t.retries > 0).length;
  const totalSteps = tests.reduce((n, t) => n + t.steps.length, 0);
  const suiteDurationMs = suite.durationMs || tests.reduce((n, t) => n + (t.durationMs || 0), 0);
  const verdict = failed > 0 ? 'FAILED' : 'PASSED';
  // Stable id per test — shared by the list rows and the embedded detail data.
  tests.forEach((t, i) => (t.id = i));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.suiteName)} · AppClaw Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${styles()}</style>
</head>
<body>
<div class="grain"></div>
<a id="back-dashboard" class="back-link" href="/" hidden aria-label="back to dashboard">← Dashboard</a>
<button id="theme-toggle" class="theme-toggle" onclick="toggleTheme()" aria-label="toggle light / dark theme" title="Toggle theme">☾</button>
<main>
  <header class="cockpit reveal">
    ${renderHero(meta, {
      verdict,
      passRate,
      ran,
      passed,
      durationMs: suiteDurationMs,
      stats: { total, passed, failed, skipped, flaky, totalSteps },
    })}
    ${renderDevices(meta, tests)}
  </header>
  <section class="split-view reveal">
    <aside class="tests-panel" id="tests-panel">
      ${renderResults(tests)}
    </aside>
    <section class="detail-panel" id="detail-panel">
      <div class="detail-empty">Select a test to see its steps.</div>
    </section>
  </section>
  ${renderFooter(meta)}
</main>
<script>window.__REPORT__=${embedJson(buildData(tests))};</script>
<script>${script()}</script>
</body>
</html>`;
}

/** JSON for an inline <script>, with `<` escaped so it can't close the tag. */
function embedJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function renderHero(
  meta: SuiteReportMeta,
  d: {
    verdict: string;
    passRate: number;
    ran: number;
    passed: number;
    durationMs: number;
    stats: {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      flaky: number;
      totalSteps: number;
    };
  }
): string {
  const { verdict, passRate, ran, passed, durationMs, stats } = d;
  const R = 34;
  const C = 2 * Math.PI * R;
  const dash = (passRate / 100) * C;
  const platIcon = meta.platform === 'ios' ? '' : '';

  const total = Math.max(stats.total, 1);
  // Compact 7-cell mini grid slotted between the title area and the donut so
  // there's no empty column on the right of the hero. Bars are 1px slivers
  // under each metric — enough to encode proportion without stealing weight
  // from the number.
  const cells: Array<{ label: string; value: string; tone: string; ratio: number | null }> = [
    { label: 'tests', value: String(stats.total), tone: 'neutral', ratio: null },
    { label: 'passed', value: String(stats.passed), tone: 'pass', ratio: stats.passed / total },
    {
      label: 'failed',
      value: String(stats.failed),
      tone: stats.failed ? 'fail' : 'muted',
      ratio: stats.failed / total,
    },
    {
      label: 'flaky',
      value: String(stats.flaky),
      tone: stats.flaky ? 'flaky' : 'muted',
      ratio: stats.flaky / total,
    },
    {
      label: 'skipped',
      value: String(stats.skipped),
      tone: stats.skipped ? 'skip' : 'muted',
      ratio: stats.skipped / total,
    },
    { label: 'steps', value: String(stats.totalSteps), tone: 'neutral', ratio: null },
    { label: 'duration', value: fmtDur(durationMs), tone: 'neutral', ratio: null },
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
      <div class="brand"><span class="brand-mark">◐</span> AppClaw<span class="brand-sub">runner report</span></div>
      <h1 class="suite">${esc(meta.suiteName)}</h1>
      <div class="hero-meta">
        <span class="chip plat plat-${esc(meta.platform)}">${platIcon} ${esc(meta.platform)}</span>
        <span class="chip">${esc(fmtDate(meta.startedAt))}</span>
        <span class="chip">${esc(fmtClock(durationMs))} wall</span>
        <span class="chip">${meta.devices.length} device${meta.devices.length === 1 ? '' : 's'} · ${meta.workers} worker${meta.workers === 1 ? '' : 's'}</span>
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
            <div class="rate">${passRate}<span>%</span></div>
          </div>
        </div>
        <div class="verdict verdict-${verdict.toLowerCase()}">
          <span class="dot"></span>${verdict}
          <span class="verdict-sub">${passed}/${ran || passed}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function renderDevices(meta: SuiteReportMeta, tests: ReportTest[]): string {
  const byDevice = new Map<string, ReportTest[]>();
  for (const t of tests) {
    // Skipped tests never ran on a device — `assembleTests` fills device with
    // '—' as a placeholder. Don't surface that as a phantom device card.
    if (!t.device || t.device === '—') continue;
    if (!byDevice.has(t.device)) byDevice.set(t.device, []);
    byDevice.get(t.device)!.push(t);
  }
  if (byDevice.size === 0) return '';
  const chips = [...byDevice]
    .map(([name, group]) => {
      const pass = group.filter((t) => t.status === 'passed').length;
      const fail = group.filter((t) => t.status === 'failed').length;
      const os = group.find((t) => t.osVersion)?.osVersion;
      return `<button type="button" class="dev-chip" data-device="${esc(name)}" onclick="toggleDeviceFilter('${esc(name)}')">
        <span class="dev-icon"></span>
        <span class="dev-name">${esc(name)}</span>
        ${os ? `<span class="dev-os">${esc(os)}</span>` : ''}
        <span class="dev-tally"><span class="pass">${pass}✓</span>${fail ? `<span class="fail">${fail}✗</span>` : ''}</span>
      </button>`;
    })
    .join('');
  return `<div class="dev-strip">
    <span class="strip-label">devices <span class="strip-count">${byDevice.size}</span></span>
    <div class="dev-strip-chips">${chips}</div>
  </div>`;
}

function renderResults(tests: ReportTest[]): string {
  const byFile = new Map<string, ReportTest[]>();
  for (const t of tests) {
    if (!byFile.has(t.file)) byFile.set(t.file, []);
    byFile.get(t.file)!.push(t);
  }

  const groups = [...byFile]
    .map(([file, group]) => {
      const pass = group.filter((t) => t.status === 'passed').length;
      const fail = group.filter((t) => t.status === 'failed').length;
      const rows = group.map((t) => renderTest(t)).join('');
      // Groups collapse by default; a failing group stays open so problems are
      // one glance away. `expandGroupOf(id)` on load also opens whichever group
      // owns the auto-selected test.
      const collapsed = fail === 0 ? ' collapsed' : '';
      // Compact tally chips instead of a wrappy "all passed" pill.
      const tally =
        (pass > 0 ? `<span class="tally tally-pass">✓ ${pass}</span>` : '') +
        (fail > 0 ? `<span class="tally tally-fail">✗ ${fail}</span>` : '');
      return `<div class="file-group${collapsed}" data-file="${esc(file)}">
        <button type="button" class="file-head" onclick="toggleFileGroup(this)" aria-expanded="${fail > 0 ? 'true' : 'false'}">
          <span class="file-icon">›</span>
          <span class="file-path">${esc(file)}</span>
          <span class="file-tally">${tally}</span>
        </button>
        <div class="file-body">${rows}</div>
      </div>`;
    })
    .join('');

  return `<section class="results reveal">
    <div class="results-head">
      <h2 class="section-title">Results</h2>
      <div class="controls">
        <input id="search" class="search" type="search" placeholder="filter tests…" autocomplete="off">
        <div class="filters" role="tablist">
          <button class="filter active" data-filter="all">All</button>
          <button class="filter" data-filter="failed">Failed</button>
          <button class="filter" data-filter="passed">Passed</button>
          <button class="filter" data-filter="flaky">Flaky</button>
        </div>
      </div>
    </div>
    <div id="groups">${groups}</div>
    <div id="empty" class="empty" hidden>No tests match.</div>
  </section>`;
}

/** A clickable list row — opens the per-test detail view (Step Inspector). */
function renderTest(t: ReportTest): string {
  const flaky = t.status === 'passed' && t.retries > 0;
  const stepN = t.steps.length;
  const glyph = t.status === 'passed' ? '✓' : t.status === 'failed' ? '✗' : '⊘';
  return `<button class="test status-${t.status}" data-idx="${t.id}" data-status="${t.status}" data-flaky="${flaky}" data-device="${esc(t.device)}" data-title="${esc(t.title.toLowerCase())}" onclick="openTest(${t.id})">
    <span class="status-glyph s-${t.status}">${glyph}</span>
    <span class="test-title">${esc(t.title)}</span>
    <span class="test-tags">
      ${t.retries > 0 ? `<span class="tag tag-flaky">↻ ${t.retries}</span>` : ''}
      <span class="tag tag-device">${esc(t.device)}</span>
      ${stepN ? `<span class="tag tag-steps">${stepN} step${stepN === 1 ? '' : 's'}</span>` : ''}
      <span class="tag tag-time">${esc(fmtDur(t.durationMs))}</span>
    </span>
    <span class="chevron">›</span>
  </button>`;
}

/**
 * The instruction as the user wrote it in their test — that's what belongs in
 * the step label + the inspector's "Instruction" field. The engine's result
 * `message` ("Tapped …") is shown separately in the inspector's Message row.
 */
function stepDescription(s: StepArtifact): string {
  return s.verbatim || s.target || s.message || s.kind;
}

/* ── client data model (embedded as JSON, rendered by the detail SPA) ── */

interface ClientStep {
  n: number;
  kind: string;
  desc: string;
  status: string;
  durationMs: number;
  message?: string;
  phase?: string;
  img?: string;
  /** Ms from run start to this step — used to sync the step with the recording. */
  offsetMs?: number;
  /**
   * Raw tap point in device pixels, plus the reference frame to scale against.
   * `w`/`h` come from deviceScreenSize/screenshotSize when known; otherwise the
   * client falls back to the screenshot's natural pixel size (Android tap coords
   * already live in the screenshot's pixel space).
   */
  tap?: { x: number; y: number; w?: number; h?: number };
}
interface ClientHook {
  kind: string;
  scope?: string;
  status: string;
  durationMs: number;
  error?: string;
  logs?: string;
}
interface ClientTest {
  id: number;
  title: string;
  file: string;
  device: string;
  os?: string;
  status: string;
  durationMs: number;
  retries: number;
  error?: string;
  video?: string;
  /** appium-mcp server log tail (failed tests only). */
  mcpLog?: string;
  steps: ClientStep[];
  hooks: ClientHook[];
}

/** Everything the detail view needs, keyed by test id. */
function buildData(tests: ReportTest[]): ClientTest[] {
  return tests.map((t) => ({
    id: t.id ?? 0,
    title: t.title,
    file: t.file,
    device: t.device,
    os: t.osVersion,
    status: t.status,
    durationMs: t.durationMs,
    retries: t.retries,
    error: t.error,
    video: t.videoData,
    mcpLog: t.appiumMcpLog,
    hooks: (t.hooks ?? []).map((h) => ({
      kind: h.kind,
      scope: h.scope,
      status: h.status,
      durationMs: h.durationMs,
      error: h.error,
      logs: h.logs,
    })),
    steps: t.steps.map((s, i) => ({
      n: i + 1,
      kind: s.kind,
      desc: stepDescription(s),
      status: s.status,
      durationMs: s.durationMs,
      message: s.message,
      phase: s.phase,
      img: s.img,
      offsetMs: s.videoOffsetMs,
      tap: s.tapCoordinates
        ? {
            x: s.tapCoordinates.x,
            y: s.tapCoordinates.y,
            w: s.deviceScreenSize?.width ?? s.screenshotSize?.width,
            h: s.deviceScreenSize?.height ?? s.screenshotSize?.height,
          }
        : undefined,
    })),
  }));
}

function renderFooter(meta: SuiteReportMeta): string {
  const env = [meta.provider, meta.model].filter(Boolean).join(' · ');
  return `<footer class="footer reveal">
    <div class="footer-left">
      Generated by <strong>AppClaw</strong> · suite <code>${esc(meta.suiteId)}</code>
    </div>
    <div class="footer-right">${env ? esc(env) : 'mobile agentic test run'}</div>
  </footer>`;
}

/* ───────────────────────── styles ──────────────────────────────── */

function styles(): string {
  return `
:root{
  /* matches the AppClaw site (landing/) — deep-ink dark, bright cyan accent */
  --bg:#0b0e13; --panel:#161a22; --panel-2:#1b2029; --line:#272d37;
  --ink:#e6eaf1; --muted:#919aab; --faint:#5b6473;
  --brand:#19d4ec; --brand-soft:rgba(25,212,236,.14); --brand-rgb:25,212,236;
  --pass:#3ddc97; --fail:#f0596a; --skip:#6b7280; --flaky:#f0b429;
  --r:16px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;background:
    radial-gradient(1100px 520px at 82% -8%, rgba(25,212,236,.10), transparent 60%),
    radial-gradient(900px 600px at -5% 0%, rgba(99,102,241,.07), transparent 55%),
    var(--bg);
  color:var(--ink);
  font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
  font-size:15.5px;line-height:1.55;-webkit-font-smoothing:antialiased;
  min-height:100vh;
}
.grain{position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
main{position:relative;z-index:1;max-width:1500px;margin:0 auto;padding:40px 28px 80px}
code{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:.85em}

/* reveal */
.reveal{opacity:0;transform:translateY(14px);animation:rise .7s cubic-bezier(.2,.7,.2,1) forwards}
.cockpit{animation-delay:0s}.split-view{animation-delay:.12s}.results{animation-delay:.18s}.footer{animation-delay:.24s}
@keyframes rise{to{opacity:1;transform:none}}

/* light theme — flips the variable palette + a few dark-only spots */
body.light{
  --bg:#f3f6f8; --panel:#ffffff; --panel-2:#eef2f6; --line:#dce2ea;
  --ink:#15202c; --muted:#5c6675; --faint:#97a1ae;
  --brand:#0a97ad; --brand-soft:rgba(10,151,173,.12); --brand-rgb:10,151,173;
  --pass:#13a06a; --fail:#e0485f; --skip:#8a909c; --flaky:#c08400;
  background:radial-gradient(1100px 520px at 82% -8%, rgba(10,151,173,.07), transparent 60%),#f3f6f8;
  color:var(--ink);
}
body.light .grain{opacity:.015}
body.light .suite{background:linear-gradient(180deg,#13161d,#454c5a);-webkit-background-clip:text;background-clip:text}
body.light .donut-track{stroke:rgba(0,0,0,.08)}
body.light .cockpit{box-shadow:0 24px 60px -42px rgba(20,30,60,.3)}
body.light .chip{background:rgba(0,0,0,.02)}

/* theme toggle */
.theme-toggle{position:fixed;top:18px;right:18px;z-index:40;width:40px;height:40px;border-radius:11px;
  border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:17px;cursor:pointer;
  display:grid;place-items:center;transition:.15s;box-shadow:0 6px 18px -10px rgba(0,0,0,.5)}
.theme-toggle:hover{border-color:var(--brand);color:var(--brand)}
.back-link{position:fixed;top:18px;left:18px;z-index:40;height:40px;padding:0 15px;border-radius:11px;
  border:1px solid var(--line);background:var(--panel);color:var(--muted);font-family:"JetBrains Mono",monospace;
  font-size:13.5px;text-decoration:none;display:inline-flex;align-items:center;transition:.15s;
  box-shadow:0 6px 18px -10px rgba(0,0,0,.5)}
.back-link:hover{border-color:var(--brand);color:var(--brand)}
.back-link[hidden]{display:none}

/* ── cockpit: hero + stats + devices fused into one dense strip ── */
.cockpit{border:1px solid var(--line);border-radius:20px;overflow:hidden;position:relative;
  background:linear-gradient(160deg,var(--panel-2),var(--panel));
  box-shadow:0 30px 80px -40px rgba(0,0,0,.8)}
.cockpit::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(var(--brand-rgb),.55),transparent);opacity:.75}
.cockpit::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(90deg,rgba(var(--brand-rgb),.06),transparent 40%);opacity:.9}
.cockpit-rule{height:1px;background:var(--line);opacity:.55;margin:0 22px}

/* hero row inside the cockpit — 3 columns: title │ mini-stats │ donut+verdict */
.hero-strip{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:24px;align-items:stretch;
  padding:18px 22px 16px;position:relative;z-index:1}
.hero-left{min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:8px}
.brand{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:8px}
.brand-mark{color:var(--brand);font-size:14px}
.brand-sub{color:var(--faint)}
.suite{font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;
  font-size:clamp(22px,2.4vw,32px);line-height:1.1;letter-spacing:-.02em;margin:8px 0 12px;
  background:linear-gradient(180deg,#fff,#c8cbd6);-webkit-background-clip:text;background-clip:text;color:transparent;
  overflow-wrap:anywhere}
.hero-meta{display:flex;flex-wrap:wrap;gap:7px}
.chip{font-family:"JetBrains Mono",monospace;font-size:12.5px;padding:4px 11px;border-radius:999px;
  border:1px solid var(--line);background:rgba(255,255,255,.02);color:var(--muted)}
.chip.plat{text-transform:uppercase;letter-spacing:.06em;color:var(--ink);border-color:var(--brand);background:var(--brand-soft)}

/* right side: [mini-stats grid][donut+verdict pinned to far right] */
.hero-right{display:flex;align-items:stretch;gap:16px;flex-shrink:0;border-left:1px solid var(--line);padding-left:16px}

/* mini-stats: 4×2 grid, hair-thin dividers between cells */
.hero-mstats{display:grid;grid-template-columns:repeat(4,minmax(72px,1fr));
  align-items:center;column-gap:0;row-gap:0}
.mstat{position:relative;padding:6px 12px;border-right:1px solid var(--line)}
.hero-mstats > .mstat:nth-child(4n){border-right:none}
.hero-mstats > .mstat:nth-child(-n+4){border-bottom:1px solid var(--line);padding-bottom:8px}
.hero-mstats > .mstat:nth-child(n+5){padding-top:8px}
.mstat-value{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:20px;line-height:1;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink)}
.mstat-label{font-family:"JetBrains Mono",monospace;font-size:10px;text-transform:uppercase;
  letter-spacing:.16em;color:var(--muted);margin-top:6px}
.mstat-bar{display:block;margin-top:7px;height:2px;background:rgba(255,255,255,.05);border-radius:1px;position:relative;overflow:hidden}
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

/* donut + verdict pinned to the far right of the hero row */
.hero-summary{display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;border-left:1px solid var(--line);padding-left:16px;justify-content:center}
.donut{position:relative;width:82px;height:82px}
.donut svg{transform:rotate(-90deg);width:82px;height:82px}
.donut circle{fill:none;stroke-width:8;stroke-linecap:round}
.donut-track{stroke:rgba(255,255,255,.06)}
.donut-value{stroke:var(--pass);stroke-dasharray:var(--circ);stroke-dashoffset:var(--circ);
  animation:draw 1.1s cubic-bezier(.3,.8,.3,1) .25s forwards}
@keyframes draw{to{stroke-dashoffset:calc(var(--circ) - var(--dash))}}
.donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.rate{font-family:"JetBrains Mono",monospace;font-weight:700;font-size:19px;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rate span{font-size:10px;color:var(--muted);margin-left:1px}
.verdict{display:inline-flex;align-items:center;gap:7px;font-family:"JetBrains Mono",monospace;
  font-weight:700;font-size:12.5px;letter-spacing:.14em;padding:5px 12px;border-radius:8px;border:1px solid var(--line);text-transform:uppercase}
.verdict .dot{width:7px;height:7px;border-radius:50%}
.verdict-sub{font-size:11.5px;font-weight:500;color:var(--muted);letter-spacing:.02em}
.verdict-passed{color:var(--pass);border-color:rgba(61,220,151,.35)}.verdict-passed .dot{background:var(--pass);box-shadow:0 0 10px var(--pass)}
.verdict-failed{color:var(--fail);border-color:rgba(240,89,106,.35)}.verdict-failed .dot{background:var(--fail);box-shadow:0 0 10px var(--fail)}

/* devices strip — inline pill chips inside the cockpit */
.dev-strip{display:flex;align-items:center;gap:12px;padding:0 22px 16px;flex-wrap:wrap;position:relative;z-index:1}
.strip-label{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--faint);display:inline-flex;align-items:center;gap:7px;
  padding-right:12px;border-right:1px solid var(--line)}
.strip-count{color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 7px;font-size:10.5px}
.dev-strip-chips{display:inline-flex;gap:8px;flex-wrap:wrap;flex:1}
.dev-chip{display:inline-flex;align-items:center;gap:8px;padding:7px 13px 7px 11px;border-radius:999px;
  border:1px solid var(--line);background:var(--panel);color:inherit;font-family:"JetBrains Mono",monospace;
  font-size:13px;cursor:pointer;transition:.15s;position:relative}
.dev-chip:hover{border-color:var(--brand);color:var(--ink)}
.dev-chip.active{border-color:var(--brand);background:var(--brand-soft);box-shadow:0 0 0 2px rgba(var(--brand-rgb),.16);color:var(--ink)}
.dev-icon{width:9px;height:13px;border-radius:2px;background:linear-gradient(160deg,#2b3348,#141822);
  border:1px solid var(--faint);flex-shrink:0}
.dev-name{font-weight:600;color:var(--ink)}
.dev-os{color:var(--muted);font-size:12px}
.dev-tally{display:inline-flex;gap:7px;margin-left:4px;padding-left:9px;border-left:1px solid var(--line);font-size:12px}
.dev-tally .pass{color:var(--pass);font-weight:600}
.dev-tally .fail{color:var(--fail);font-weight:600}

/* section — used by the results grid and other headings */
.section-title{font-family:"Plus Jakarta Sans",sans-serif;font-weight:700;font-size:18px;
  margin:0 0 14px;display:flex;align-items:center;gap:9px}
.section-title .count,.file-count{font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--muted);
  border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.faint{color:var(--faint)}

/* results */
.results{margin-top:40px}
.results-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.results-head .section-title{margin:0}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search{font-family:"JetBrains Mono",monospace;font-size:14px;background:var(--panel);border:1px solid var(--line);
  color:var(--ink);padding:8px 13px;border-radius:10px;width:190px;outline:none}
.search:focus{border-color:var(--brand)}
.filters{display:flex;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:3px}
.filter{font-family:"Inter",sans-serif;font-size:14px;font-weight:500;color:var(--muted);background:none;
  border:none;padding:6px 13px;border-radius:7px;cursor:pointer;transition:.15s}
.filter:hover{color:var(--ink)}
.filter.active{background:var(--brand);color:#04222a;font-weight:600}

.file-group{margin-bottom:16px}
.file-head{display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--line);margin-bottom:6px;
  width:100%;background:none;border-left:none;border-right:none;border-top:none;color:inherit;font-family:inherit;text-align:left;cursor:pointer}
.file-head:hover .file-path{color:var(--brand)}
.file-icon{color:var(--brand);flex-shrink:0;display:inline-block;transition:transform .15s ease;font-size:14px;line-height:1}
.file-group.collapsed .file-icon{transform:rotate(-90deg)}
.file-group.collapsed .file-body{display:none}
.file-group.collapsed .file-head{margin-bottom:0;border-bottom-color:transparent}
.file-path{font-family:"JetBrains Mono",monospace;font-size:13.5px;color:var(--ink);font-weight:500;
  flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-tally{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;font-family:"JetBrains Mono",monospace;font-size:12px}
.tally{display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border-radius:6px;font-weight:600;line-height:1.4}
.tally-pass{color:var(--pass);background:rgba(61,220,151,.12)}
.tally-fail{color:var(--fail);background:rgba(240,89,106,.14)}

.test{width:100%;display:flex;align-items:center;gap:13px;padding:14px 16px;text-align:left;
  border:1px solid var(--line);border-radius:13px;background:var(--panel);margin-bottom:8px;cursor:pointer;
  color:var(--ink);font-family:inherit;font-size:15px;transition:border-color .2s,transform .12s,background .2s}
.test.status-failed{border-color:rgba(255,107,129,.35)}
.test:hover{border-color:var(--brand);background:var(--panel-2);transform:translateX(2px)}
.status-glyph{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font-size:13px;flex-shrink:0;font-weight:700}
.s-passed{background:rgba(61,220,151,.16);color:var(--pass)}
.s-failed{background:rgba(255,107,129,.16);color:var(--fail)}
.s-skipped{background:rgba(107,114,128,.16);color:var(--skip)}
.test-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.test-tags{display:flex;gap:6px;align-items:center;flex-shrink:0}
.tag{font-family:"JetBrains Mono",monospace;font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag-device{color:var(--ink)}
.tag-flaky{color:var(--flaky);border-color:rgba(240,180,41,.4)}
.tag-time{color:var(--brand);border-color:rgba(var(--brand-rgb),.3)}
.chevron{color:var(--faint);font-size:20px;transition:transform .15s,color .15s}
.test:hover .chevron{color:var(--brand);transform:translateX(3px)}

.error-box{border:1px solid rgba(255,107,129,.3);border-radius:10px;background:rgba(255,107,129,.06);padding:12px 14px;margin:8px 0 14px}
.error-label{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--fail);font-weight:600;margin-bottom:7px}
.error-msg{font-family:"JetBrains Mono",monospace;font-size:13.5px;color:#ffd2d9;margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.55}
body.light .error-msg{color:#7a1a2a}
body.light .error-box{background:rgba(224,72,95,.09);border-color:rgba(224,72,95,.35)}
body.light .error-label{color:#c2263b}
.video-row{margin:6px 0 14px}
.video-link{font-family:"JetBrains Mono",monospace;font-size:14px;color:var(--brand);text-decoration:none;border:1px solid rgba(var(--brand-rgb),.3);padding:7px 13px;border-radius:8px}
.video-link:hover{background:var(--brand-soft)}
.no-steps,.no-shot{color:var(--faint);font-size:14px;font-style:italic}

/* shared phone frame */
.phone{display:block;padding:6px;border-radius:18px;background:linear-gradient(160deg,#262d3e,#0f121a);
  border:1px solid #313a4f;box-shadow:0 14px 30px -16px rgba(0,0,0,.9)}
.phone-screen{position:relative;display:block;border-radius:13px;overflow:hidden;background:#000;aspect-ratio:9/19.5}
.phone-screen img{width:100%;height:100%;object-fit:cover;display:block}
.no-shot{display:grid;place-items:center;height:100%;color:var(--faint)}
.tap{position:absolute;width:26px;height:26px;border-radius:50%;transform:translate(-50%,-50%);
  border:2px solid var(--brand);background:rgba(var(--brand-rgb),.25);box-shadow:0 0 0 0 rgba(var(--brand-rgb),.5);
  animation:tap 1.8s ease-out infinite;pointer-events:none}
@keyframes tap{0%{box-shadow:0 0 0 0 rgba(var(--brand-rgb),.5)}70%{box-shadow:0 0 0 16px rgba(var(--brand-rgb),0)}100%{box-shadow:0 0 0 0 rgba(var(--brand-rgb),0)}}
.step-kind{font-family:"JetBrains Mono",monospace;font-size:10px;text-transform:uppercase;letter-spacing:.05em;
  padding:2px 7px;border-radius:5px;background:var(--panel-2);border:1px solid var(--line);color:var(--muted)}

.st-passed{color:var(--pass)}.st-failed{color:var(--fail)}.st-skipped{color:var(--skip)}

/* ── split view: tests list left, detail right ── */
.split-view{display:grid;grid-template-columns:minmax(300px,340px) 1fr;gap:20px;margin-top:36px;align-items:start}
.tests-panel{position:sticky;top:20px;max-height:calc(100vh - 40px);overflow:auto;
  border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:14px 12px}
.tests-panel .results{margin:0}
.tests-panel .results-head{flex-direction:column;align-items:stretch;gap:10px;margin-bottom:12px}
.tests-panel .section-title{font-size:16px;margin:0}
.tests-panel .controls{gap:8px;flex-wrap:wrap}
.tests-panel .search{width:100%}
.tests-panel .filters{width:100%;justify-content:space-between}
.tests-panel .filter{padding:5px 11px;font-size:13px}
.tests-panel .file-head{padding:9px 4px;margin-bottom:7px}
.tests-panel .file-path{font-size:13px}
.tests-panel .file-badge{font-size:11px;padding:2px 8px}
.tests-panel .file-count{font-size:12px}
.tests-panel .test{padding:10px 12px;font-size:14px;border-radius:10px;gap:10px;margin-bottom:6px;flex-wrap:nowrap;align-items:center}
.tests-panel .test .test-title{min-width:0;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tests-panel .test .test-tags{gap:5px;flex-shrink:0}
.tests-panel .test .tag{font-size:11px;padding:2px 7px}
.tests-panel .test .tag-device,
.tests-panel .test .tag-steps{display:none}
.tests-panel .test .chevron{display:none}
.tests-panel .test.active{border-color:var(--brand);background:var(--panel-2);box-shadow:0 0 0 2px rgba(var(--brand-rgb),.18)}
.detail-panel{border:1px solid var(--line);border-radius:16px;background:var(--panel);padding:22px 24px;min-height:400px}
.detail-empty{color:var(--faint);text-align:center;padding:80px 20px;font-style:italic}

/* ── detail view (per-test Step Inspector) — now mounted inside .detail-panel ── */
.detail{position:relative;z-index:1;margin:0;padding:0}
.detail[hidden]{display:none}
@keyframes slidein{from{opacity:0;transform:translateX(18px)}}
.dt-top{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-bottom:8px}
.dt-back{font-family:"JetBrains Mono",monospace;font-size:14px;color:var(--muted);background:var(--panel);
  border:1px solid var(--line);border-radius:9px;padding:8px 14px;cursor:pointer;transition:.15s}
.dt-back:hover{color:var(--ink);border-color:var(--brand)}
.dt-title{font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;font-size:clamp(22px,3vw,32px);
  letter-spacing:-.01em;margin:0;flex:1;min-width:200px}
.dt-verdict{font-family:"Plus Jakarta Sans",sans-serif;font-weight:800;letter-spacing:.04em;font-size:16px;
  padding:6px 14px;border-radius:10px;border:1px solid var(--line)}
.dt-verdict.v-passed{color:var(--pass);border-color:rgba(61,220,151,.4)}
.dt-verdict.v-failed{color:var(--fail);border-color:rgba(255,107,129,.4)}
.dt-verdict.v-skipped{color:var(--skip)}
.dt-meta{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 18px}
.dt-rec{color:var(--brand);cursor:pointer;font-family:inherit;border-color:rgba(var(--brand-rgb),.35)!important}
.dt-rec:hover{background:var(--brand-soft)}
.dt-rec.on{background:var(--brand);color:#04222a;border-color:var(--brand)!important}
.dt-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;background:#000}
.dt-logs{margin-top:20px}
.dt-logs-head{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-bottom:10px}
.logblk{border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-bottom:10px;overflow:hidden}
.logblk>summary{cursor:pointer;padding:12px 14px;font-size:14px;font-weight:600;list-style:none;user-select:none}
.logblk>summary::-webkit-details-marker{display:none}
.logblk>summary::before{content:'▸';display:inline-block;margin-right:8px;color:var(--faint);transition:transform .15s}
.logblk[open]>summary::before{transform:rotate(90deg)}
.logsub{font-weight:400;color:var(--faint);font-size:12px}
.logpre{margin:0;padding:14px;border-top:1px solid var(--line);background:var(--bg);font-family:"JetBrains Mono",monospace;font-size:13px;line-height:1.6;color:var(--muted);white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto}
/* The author display:block above beats the UA [hidden]{display:none}, so the
   video would cover the screenshot by default. Restore hidden-means-hidden. */
.dt-video[hidden]{display:none}

/* tabs (Steps / Hooks / Logs) */
.dt-tabs{display:flex;gap:4px;margin:14px 0 12px;border-bottom:1px solid var(--line)}
.dt-tab-btn{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);
  font-family:"Inter",sans-serif;font-size:14px;font-weight:500;padding:9px 15px;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;transition:.15s;margin-bottom:-1px}
.dt-tab-btn:hover{color:var(--ink)}
.dt-tab-btn.active{color:var(--ink);border-bottom-color:var(--brand)}
.dt-tab-btn.has-fail{color:var(--fail)}
.dt-tab-btn.has-fail.active{border-bottom-color:var(--fail)}
.dt-tab-count{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--faint);
  border:1px solid var(--line);border-radius:999px;padding:1px 7px}
.dt-tab-btn.active .dt-tab-count{color:var(--muted);border-color:var(--line)}
.dt-empty{color:var(--faint);padding:32px 20px;font-style:italic;text-align:center;
  border:1px dashed var(--line);border-radius:12px}
.dt-empty code{font-style:normal;color:var(--muted);background:var(--panel-2);padding:1px 5px;border-radius:4px}

/* hooks list */
.hook-list{display:flex;flex-direction:column;gap:6px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:8px}
.hook-row{display:grid;grid-template-columns:110px 1fr auto auto;gap:12px;align-items:center;
  padding:10px 12px;border-radius:8px;border:1px solid transparent}
.hook-row.s-failed{border-color:rgba(240,89,106,.35);background:rgba(240,89,106,.06)}
.hook-kind{font-family:"JetBrains Mono",monospace;font-size:12px;padding:3px 9px;border-radius:6px;
  border:1px solid var(--line);color:var(--muted);text-transform:none;text-align:center}
.hook-kind.hk-beforeAll,.hook-kind.hk-beforeEach,.hook-kind.hk-deviceSetup{color:var(--brand);border-color:rgba(var(--brand-rgb),.35)}
.hook-kind.hk-afterEach,.hook-kind.hk-afterAll{color:var(--flaky);border-color:rgba(240,180,41,.35)}
.hook-title{font-size:15px;font-weight:500;color:var(--ink)}
.hook-scope{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--faint);margin-left:8px}
.hook-status{font-size:15px;font-weight:700}
.hook-status.s-passed{color:var(--pass)}.hook-status.s-failed{color:var(--fail)}
.hook-time{font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--faint)}
.hook-err{margin:6px 0 0;padding:9px 11px;background:var(--bg);border:1px solid var(--line);border-radius:6px;
  font-family:"JetBrains Mono",monospace;font-size:13px;color:#ffd2d9;white-space:pre-wrap;word-break:break-word;grid-column:1 / -1}
body.light .hook-err{color:#7a1a2a}
.hook-logs{margin:8px 0 0;border:1px solid var(--line);border-radius:6px;background:var(--bg);overflow:hidden}
.hook-logs>summary{cursor:pointer;padding:7px 11px;font-size:13px;list-style:none;user-select:none;
  display:flex;align-items:center;gap:8px;color:var(--muted)}
.hook-logs>summary::-webkit-details-marker{display:none}
.hook-logs>summary::before{content:'▸';display:inline-block;color:var(--faint);transition:transform .15s}
.hook-logs[open]>summary::before{transform:rotate(90deg)}
.hook-logs-label{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.hook-logs-count{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--faint);
  border:1px solid var(--line);border-radius:999px;padding:1px 8px;margin-left:auto}
.hook-logs-pre{margin:0;padding:11px 13px;border-top:1px solid var(--line);background:var(--panel);
  font-family:"JetBrains Mono",monospace;font-size:13px;line-height:1.6;color:var(--muted);
  white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}
.hook-divider{display:flex;align-items:center;gap:11px;padding:5px 8px;margin:3px 0}
.hook-divider-line{flex:1;height:1px;background:var(--line)}
.hook-divider-label{font-family:"JetBrains Mono",monospace;font-size:12px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--muted);white-space:nowrap;display:inline-flex;align-items:center;gap:7px}

.dt-grid{display:grid;grid-template-columns:240px 1fr 260px;gap:16px;align-items:start}
.dt-panel{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
.dt-steps-head,.dt-insp-head{font-family:"JetBrains Mono",monospace;font-size:12px;text-transform:uppercase;
  letter-spacing:.12em;color:var(--muted);padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between}
.dt-steps{padding:6px;max-height:74vh;overflow:auto}
.dt-step{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 12px;border:1px solid transparent;
  border-radius:10px;background:none;color:var(--ink);cursor:pointer;font-family:inherit;font-size:14.5px;transition:.12s}
.dt-step:hover{background:var(--panel-2)}
.dt-step.active{background:rgba(var(--brand-rgb),.1);border-color:rgba(var(--brand-rgb),.4)}
.dt-step-n{width:26px;height:26px;border-radius:7px;flex-shrink:0;display:grid;place-items:center;font-size:12px;font-weight:700;
  font-family:"JetBrains Mono",monospace;background:var(--panel-2);border:1px solid var(--line);color:var(--muted)}
.dt-step.s-passed .dt-step-n{color:var(--pass);border-color:rgba(61,220,151,.4)}
.dt-step.s-failed .dt-step-n{color:var(--fail);border-color:rgba(255,107,129,.5)}
.dt-step-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.dt-step-desc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.dt-step-kind{font-family:"JetBrains Mono",monospace;font-size:11px;text-transform:uppercase;color:var(--faint);margin-top:2px}
.dt-step-time{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--faint);flex-shrink:0}

.dt-stage{display:flex;justify-content:center;padding:8px}
.phone.big{padding:9px;border-radius:30px}
.phone.big .phone-screen{border-radius:22px;height:min(72vh,660px);aspect-ratio:9/19.5}
.phone.big .phone-screen img{object-fit:contain}

.dt-insp{padding:6px 4px}
.insp-row{padding:13px 16px;border-bottom:1px solid var(--line)}
.insp-row:last-child{border-bottom:none}
.insp-label{font-family:"JetBrains Mono",monospace;font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--faint);margin-bottom:7px}
.insp-val{font-size:15px;color:var(--ink);word-break:break-word;line-height:1.5}
.insp-val.mono{font-family:"JetBrains Mono",monospace;font-size:14px}
.insp-pill{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:12px;text-transform:uppercase;letter-spacing:.06em;
  padding:3px 10px;border-radius:6px;border:1px solid var(--line)}
.insp-pill.s-passed{color:var(--pass);border-color:rgba(61,220,151,.4)}
.insp-pill.s-failed{color:var(--fail);border-color:rgba(255,107,129,.4)}
.dt-noshot{display:grid;place-items:center;height:100%;color:var(--faint);font-style:italic}
@media(max-width:960px){.dt-grid{grid-template-columns:1fr}.phone.big .phone-screen{height:auto;max-height:70vh}}

.empty{text-align:center;color:var(--faint);padding:50px;font-style:italic}

/* footer */
.footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);display:flex;
  justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13.5px;color:var(--muted)}
.footer code{color:var(--faint)}
.footer strong{color:var(--brand);font-weight:600}

@media(max-width:1200px){
  .split-view{grid-template-columns:1fr}
  .tests-panel{position:static;max-height:none}
}
@media(max-width:1100px){
  .hero-strip{grid-template-columns:1fr;gap:16px}
  .hero-right{border-left:none;padding-left:0;padding-top:14px;border-top:1px solid var(--line);align-items:center;justify-content:space-between}
  .hero-mstats{flex:1}
}
@media(max-width:720px){
  .hero-right{flex-direction:column;align-items:stretch}
  .hero-summary{border-left:none;padding-left:0;border-top:1px solid var(--line);padding-top:10px;flex-direction:row;justify-content:space-between}
  .hero-mstats{grid-template-columns:repeat(4,1fr)}
  .dev-strip{padding:0 20px 14px}
}`;
}

/* ───────────────────────── client script ───────────────────────── */

function script(): string {
  return `
var DATA=window.__REPORT__||[];
var cur=null, curStep=0, videoMode=false;

// ── theme (persisted) ──
function applyTheme(t){
  document.body.classList.toggle('light',t==='light');
  var b=document.getElementById('theme-toggle'); if(b)b.textContent=t==='light'?'☀':'☾';
  try{localStorage.setItem('appclaw-report-theme',t);}catch(e){}
}
function toggleTheme(){applyTheme(document.body.classList.contains('light')?'dark':'light');}
(function(){var s;try{s=localStorage.getItem('appclaw-report-theme');}catch(e){} if(s)applyTheme(s);})();
// Back-to-dashboard link only makes sense when served by the report server;
// file:// opens have no dashboard to route to, so hide it.
(function(){
  if(/^https?:$/.test(location.protocol)){
    var b=document.getElementById('back-dashboard'); if(b) b.hidden=false;
  }
})();
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmt(ms){if(!ms)return'0s';if(ms<1000)return ms+'ms';var s=ms/1000;return s<60?s.toFixed(1)+'s':Math.floor(s/60)+'m '+Math.round(s%60)+'s';}
function glyph(s){return s==='passed'?'✓':s==='failed'?'✗':'⊘';}

// ── list: filter + search + device ──
var filter='all', q='', deviceFilter='';
var applyList; // exposed so device clicks can re-run the same pipeline
(function(){
  var empty=document.getElementById('empty');
  applyList=function(){
    var any=false;
    // When any filter/search/device is active, force-expand groups so matches
    // are visible even if the user hadn't opened them. Reset to their default
    // collapsed-except-failed state when all are cleared.
    var active = filter!=='all' || q.length>0 || deviceFilter.length>0;
    document.querySelectorAll('.test').forEach(function(t){
      var s=t.dataset.status, fl=t.dataset.flaky==='true';
      var title=t.dataset.title||'', dev=t.dataset.device||'';
      var mf=filter==='all'||(filter==='flaky'?fl:s===filter);
      var mq=!q||title.indexOf(q)>-1;
      var md=!deviceFilter||dev===deviceFilter;
      var show=mf&&mq&&md;
      t.style.display=show?'':'none'; if(show)any=true;
    });
    document.querySelectorAll('.file-group').forEach(function(g){
      var vis=[].some.call(g.querySelectorAll('.test'),function(t){return t.style.display!=='none';});
      g.style.display=vis?'':'none';
      if(active) g.classList.remove('collapsed');
      else if(!g.dataset.hadFail) g.classList.add('collapsed');
    });
    empty.hidden=any;
  };
  // Remember which groups had failures at page load — those stay open when
  // filters/search reset, matching the initial render.
  document.querySelectorAll('.file-group').forEach(function(g){
    if(!g.classList.contains('collapsed')) g.dataset.hadFail='1';
  });
  document.querySelectorAll('.filter').forEach(function(b){
    b.addEventListener('click',function(){
      document.querySelectorAll('.filter').forEach(function(x){x.classList.remove('active');});
      b.classList.add('active'); filter=b.dataset.filter; applyList();
    });
  });
  var s=document.getElementById('search');
  s.addEventListener('input',function(){q=s.value.trim().toLowerCase();applyList();});
})();

// Clicking a device card scopes the test list to that device; clicking the
// same card again clears the scope. The card gains an 'active' class so it's
// visibly the source of the current filter.
function toggleDeviceFilter(name){
  deviceFilter = deviceFilter===name ? '' : name;
  document.querySelectorAll('.device-card').forEach(function(c){
    c.classList.toggle('active', c.dataset.device===deviceFilter);
  });
  if(applyList) applyList();
}

// ── collapsible spec-file groups ──
function toggleFileGroup(head){
  var g=head.parentElement;
  var open=g.classList.toggle('collapsed')===false;
  head.setAttribute('aria-expanded', open?'true':'false');
}
function expandGroupOf(el){
  var g=el&&el.closest?el.closest('.file-group'):null;
  if(!g)return;
  g.classList.remove('collapsed');
  var head=g.querySelector('.file-head'); if(head)head.setAttribute('aria-expanded','true');
}

// ── detail (Step Inspector) — always mounted in the right panel ──
function openTest(id){ selectTest(id, true); }
function selectTest(id, pushHash){
  var t=DATA[id]; if(!t)return;
  cur=id; curStep=0;
  document.querySelectorAll('.test').forEach(function(b){
    b.classList.toggle('active', +b.dataset.idx === id);
  });
  var active=document.querySelector('.test[data-idx="'+id+'"]');
  if(active){
    expandGroupOf(active);              // don't hide the row we just selected
    active.scrollIntoView({block:'nearest'});
  }
  renderDetail(t);
  if(pushHash && location.hash!=='#test-'+id) history.pushState(null,'','#test-'+id);
}
function renderDetail(t){
  videoMode=false;
  var meta='<span class="chip">'+esc(t.device)+(t.os?' · '+esc(t.os):'')+'</span>'+
    '<span class="chip">'+fmt(t.durationMs)+'</span>'+
    '<span class="chip">'+esc(t.file)+'</span>'+
    (t.retries>0?'<span class="chip" style="color:var(--flaky)">↻ '+t.retries+'</span>':'')+
    (t.video?'<button class="chip dt-rec" id="dt-rec-btn" onclick="toggleVideo()">▶ recording</button>':'');
  var err=t.error?'<div class="error-box"><div class="error-label">Failure</div><pre class="error-msg">'+esc(t.error)+'</pre></div>':'';
  var steps=t.steps.length
    ? t.steps.map(function(s,i){return '<button class="dt-step s-'+s.status+'" data-i="'+i+'" onclick="selectStep('+i+')">'+
        '<span class="dt-step-n">'+s.n+'</span>'+
        '<span class="dt-step-main"><span class="dt-step-desc">'+esc(s.desc)+'</span><span class="dt-step-kind">'+esc(s.kind)+'</span></span>'+
        '<span class="dt-step-time">'+fmt(s.durationMs)+'</span></button>';}).join('')
    : '<div class="dt-noshot" style="padding:28px">No captured steps</div>';
  var hooksBody=renderHooksTab(t);
  var logsBody=renderLogsTab(t);
  var hookFailed=(t.hooks||[]).some(function(h){return h.status==='failed';});
  // A hook failure is where the story ends — surface Hooks as the default tab
  // in that case so the reader lands on the actual point of failure.
  var initialTab = hookFailed ? 'hooks' : 'steps';
  document.getElementById('detail-panel').innerHTML=
    '<div class="dt-top">'+
      '<span class="status-glyph s-'+t.status+'">'+glyph(t.status)+'</span>'+
      '<h2 class="dt-title">'+esc(t.title)+'</h2>'+
      '<span class="dt-verdict v-'+t.status+'">'+t.status+'</span>'+
    '</div>'+
    '<div class="dt-meta">'+meta+'</div>'+err+
    '<div class="dt-tabs" role="tablist">'+
      tabBtn('steps','Steps',t.steps.length, false, initialTab)+
      tabBtn('hooks','Hooks',(t.hooks||[]).length, hookFailed, initialTab)+
      tabBtn('logs','Logs', null, false, initialTab)+
    '</div>'+
    '<div class="dt-tab dt-tab-steps"'+(initialTab==='steps'?'':' hidden')+'>'+
      '<div class="dt-grid">'+
        '<div class="dt-panel"><div class="dt-steps-head"><span>Steps</span><span>'+t.steps.length+'</span></div><div class="dt-steps">'+steps+'</div></div>'+
        '<div class="dt-stage"><div class="phone big"><div class="phone-screen">'+
          '<img id="dt-img" alt=""><span id="dt-tap" class="tap" hidden></span>'+
          (t.video?'<video id="dt-video" class="dt-video" playsinline controls preload="metadata" hidden></video>':'')+
        '</div></div></div>'+
        '<div class="dt-panel"><div class="dt-insp-head"><span>Inspector</span></div><div class="dt-insp" id="dt-insp"></div></div>'+
      '</div>'+
    '</div>'+
    '<div class="dt-tab dt-tab-hooks"'+(initialTab==='hooks'?'':' hidden')+'>'+hooksBody+'</div>'+
    '<div class="dt-tab dt-tab-logs"'+(initialTab==='logs'?'':' hidden')+'>'+logsBody+'</div>';
  if(t.steps.length) selectStep(0);
}
function tabBtn(id,label,count,mark,initial){
  var cls='dt-tab-btn'+(initial===id?' active':'')+(mark?' has-fail':'');
  var badge=(count==null||count===0)?'':'<span class="dt-tab-count">'+count+'</span>';
  return '<button type="button" class="'+cls+'" data-tab="'+id+'" onclick="showTab(\\''+id+'\\')">'+label+badge+'</button>';
}
function showTab(id){
  document.querySelectorAll('.dt-tab-btn').forEach(function(b){b.classList.toggle('active',b.dataset.tab===id);});
  ['steps','hooks','logs'].forEach(function(k){
    var el=document.querySelector('.dt-tab-'+k); if(el) el.hidden=(k!==id);
  });
}
function renderHooksTab(t){
  var hs=t.hooks||[];
  if(!hs.length) return '<div class="dt-empty">No hooks fired around this test. Configure <code>beforeEach</code> / <code>afterEach</code> in <code>appclaw.config.ts</code> or file-scope <code>beforeAll</code> / <code>afterAll</code> in your spec to see them here.</div>';
  // The runner already records hooks in chronological order (setup fans out,
  // then the test runs, then teardown). Insert a "TEST BODY" divider between
  // the last "before-" hook and the first "after-" hook so the reader can see
  // where the actual test executed within the timeline.
  var afterKinds={afterEach:1,afterAll:1,globalTeardown:1};
  var firstAfter=-1;
  for(var i=0;i<hs.length;i++){ if(afterKinds[hs[i].kind]){ firstAfter=i; break; } }
  var parts=[];
  hs.forEach(function(h,i){
    if(i===firstAfter){
      parts.push('<div class="hook-divider"><span class="hook-divider-line"></span><span class="hook-divider-label">'+glyph(t.status)+' test body</span><span class="hook-divider-line"></span></div>');
    }
    var errBlk=h.error?'<pre class="hook-err">'+esc(h.error)+'</pre>':'';
    var scope=h.scope?' <span class="hook-scope">'+esc(h.scope)+'</span>':'';
    var logBlk='';
    if(h.logs){
      var lineCount=h.logs.split('\\n').length;
      // Open by default when the hook failed — the log is usually the story.
      var openAttr=h.status==='failed'?' open':'';
      logBlk='<details class="hook-logs"'+openAttr+'><summary>'+
        '<span class="hook-logs-label">console output</span>'+
        '<span class="hook-logs-count">'+lineCount+' line'+(lineCount===1?'':'s')+'</span>'+
      '</summary><pre class="hook-logs-pre">'+esc(h.logs)+'</pre></details>';
    }
    parts.push('<div class="hook-row s-'+h.status+'">'+
      '<span class="hook-kind hk-'+esc(h.kind)+'">'+esc(h.kind)+'</span>'+
      '<span class="hook-main"><span class="hook-title">'+esc(h.kind)+scope+'</span>'+errBlk+logBlk+'</span>'+
      '<span class="hook-status s-'+h.status+'">'+glyph(h.status)+'</span>'+
      '<span class="hook-time">'+fmt(h.durationMs)+'</span>'+
    '</div>');
  });
  return '<div class="hook-list">'+parts.join('')+'</div>';
}
function renderLogsTab(t){
  var body=renderLogs(t);
  if(body) return body;
  return '<div class="dt-empty">No logs captured. Failed runs also attach the appium-mcp server tail here.</div>';
}
// AppClaw trace, reconstructed from the recorded steps — what AppClaw did, in
// order, with the failing step marked. Paired with the appium-mcp server log so
// a failure shows both sides at once.
function appclawTrace(t){
  var lines=t.steps.map(function(s){
    var mark=s.status==='failed'?'✗':(s.status==='passed'?'✓':'•');
    var msg=s.message?(' — '+s.message):'';
    return mark+' #'+s.n+' '+s.kind+': '+s.desc+msg;
  });
  if(t.error) lines.push('','✗ '+t.error);
  return lines.join('\\n');
}
// Logs are most useful on failure; show the panel for failed tests, or whenever
// a server log was captured. Collapsed by default so passing runs stay clean.
function renderLogs(t){
  var show = t.status==='failed' || !!t.mcpLog;
  if(!show) return '';
  var trace=appclawTrace(t);
  var blocks='<details class="logblk" open><summary>AppClaw log</summary><pre class="logpre">'+esc(trace)+'</pre></details>';
  if(t.mcpLog) blocks+='<details class="logblk"><summary>appium-mcp server log <span class="logsub">(shared across workers)</span></summary><pre class="logpre">'+esc(t.mcpLog)+'</pre></details>';
  return '<section class="dt-logs"><div class="dt-logs-head">Logs</div>'+blocks+'</section>';
}
function placeTap(t){
  var img=document.getElementById('dt-img'), tap=document.getElementById('dt-tap'), scr=img.parentElement;
  var w=t.w||img.naturalWidth, h=t.h||img.naturalHeight;
  if(!w||!h){tap.hidden=true;return;}
  // Match the screen box to the screenshot's aspect so the % maps 1:1 (no
  // letterbox offset from object-fit:contain), then place the pulse dot.
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
function highlightStep(i){
  document.querySelectorAll('.dt-step').forEach(function(b){b.classList.toggle('active',+b.dataset.i===i);});
  var act=document.querySelector('.dt-step[data-i="'+i+'"]'); if(act)act.scrollIntoView({block:'nearest'});
}
// The recording is usually much SHORTER than the wall-clock run (e.g. a 7.6s
// test captured as a ~2s clip), so step offsetMs (wall-clock from run start)
// can't index the video directly. Map proportionally: video fraction ↔ run
// fraction, using the test's total durationMs as the wall-clock span.
function videoTimeToStep(t,cur,dur){
  if(!dur||!isFinite(dur)||!t.durationMs)return curStep;
  var wall=(cur/dur)*t.durationMs, idx=0;
  for(var k=0;k<t.steps.length;k++){ if((t.steps[k].offsetMs||0)<=wall) idx=k; }
  return idx;
}
function stepToVideoTime(t,s,dur){
  if(!dur||!isFinite(dur)||!t.durationMs)return 0;
  return Math.max(0,Math.min(dur,((s.offsetMs||0)/t.durationMs)*dur));
}
function selectStep(i){
  var t=DATA[cur]; if(!t||!t.steps[i])return;
  curStep=i; var s=t.steps[i];
  highlightStep(i); renderInspector(s);
  if(videoMode){
    // In video mode, clicking a step seeks the recording to that moment.
    var vid=document.getElementById('dt-video');
    if(vid) vid.currentTime=stepToVideoTime(t,s,vid.duration);
    return;
  }
  var img=document.getElementById('dt-img'), tap=document.getElementById('dt-tap');
  tap.hidden=true;
  img.onload=function(){ if(curStep===i&&!videoMode&&s.tap) placeTap(s.tap); };
  if(s.img){img.style.display='';img.src=s.img;}else{img.removeAttribute('src');img.style.display='none';}
  if(s.img&&img.complete&&img.naturalWidth&&s.tap) placeTap(s.tap);
}
// Recording: plays inline in the phone, highlighting each step as it reaches it.
function toggleVideo(){
  var t=DATA[cur]; if(!t||!t.video)return;
  var vid=document.getElementById('dt-video'), img=document.getElementById('dt-img'),
      tap=document.getElementById('dt-tap'), btn=document.getElementById('dt-rec-btn');
  videoMode=!videoMode;
  if(videoMode){
    if(!vid.getAttribute('src')) vid.src=t.video;
    img.style.display='none'; tap.hidden=true; vid.hidden=false;
    if(btn)btn.classList.add('on');
    vid.parentElement.style.aspectRatio='9/19.5';
    vid.ontimeupdate=function(){
      var idx=videoTimeToStep(t,vid.currentTime,vid.duration);
      if(idx!==curStep){ curStep=idx; highlightStep(idx); renderInspector(t.steps[idx]); }
    };
    vid.play().catch(function(){});
  }else{
    vid.pause(); vid.hidden=true; img.style.display='';
    if(btn)btn.classList.remove('on');
    selectStep(curStep);
  }
}

// ── initial pick + deep-link routing + keyboard ──
function pickInitial(){
  var m=(location.hash||'').match(/^#test-(\\d+)$/);
  if(m && DATA[+m[1]]) return +m[1];
  // Prefer the first failed test if any; otherwise the first test.
  for(var i=0;i<DATA.length;i++){ if(DATA[i].status==='failed') return i; }
  return DATA.length ? 0 : -1;
}
function route(){
  var m=(location.hash||'').match(/^#test-(\\d+)$/);
  if(m && DATA[+m[1]]) selectTest(+m[1], false);
}
window.addEventListener('popstate',route);
document.addEventListener('keydown',function(e){
  // Ignore step nav while typing in the search box.
  var tag=(e.target&&e.target.tagName)||''; if(tag==='INPUT'||tag==='TEXTAREA') return;
  if(cur===null)return;
  var t=DATA[cur]; if(!t||!t.steps.length)return;
  if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();if(curStep<t.steps.length-1)selectStep(curStep+1);}
  else if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();if(curStep>0)selectStep(curStep-1);}
});
// Mount initial selection so the right pane is never empty on load.
(function(){ var id=pickInitial(); if(id>=0) selectTest(id, false); })();
`;
}
