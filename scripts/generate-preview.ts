/**
 * Generate a static HTML report preview from mock data.
 *
 * Usage: npx tsx scripts/generate-preview.ts [outDir]
 *
 * Outputs:
 *   <outDir>/index.html  — dashboard with multiple mock runs
 *   <outDir>/run.html    — single run detail page
 */

import fs from 'fs';
import path from 'path';
import { renderIndexPage, renderRunPage } from '@appclaw/core/report/renderer';
import type { RunIndex, RunManifest } from '@appclaw/core/report/types';

const outDir = process.argv[2] ?? 'preview';
fs.mkdirSync(outDir, { recursive: true });

/* ─── Mock data ──────────────────────────────────────────────── */

const NOW = new Date('2026-07-05T12:00:00Z');

function isoOffset(offsetMs: number): string {
  return new Date(NOW.getTime() - offsetMs).toISOString();
}

const mockManifest: RunManifest = {
  runId: '20260705T120000-abc',
  flowFile: 'sdk-run',
  specFile: 'tests/login.spec.ts',
  meta: {
    name: 'Login › with valid credentials',
    description: 'Verify user can log in with valid credentials',
  },
  startedAt: isoOffset(45_000),
  finishedAt: isoOffset(0),
  durationMs: 45_000,
  platform: 'android',
  device: 'Pixel 7',
  deviceVersion: 'Android 14',
  success: true,
  stepsExecuted: 5,
  stepsTotal: 5,
  steps: [
    {
      index: 0,
      kind: 'tap',
      verbatim: 'tap on the Email field',
      target: 'Email field',
      phase: 'steps',
      status: 'passed',
      durationMs: 1200,
    },
    {
      index: 1,
      kind: 'type',
      verbatim: 'type "user@example.com"',
      target: 'Email field',
      phase: 'steps',
      status: 'passed',
      durationMs: 800,
    },
    {
      index: 2,
      kind: 'tap',
      verbatim: 'tap on the Password field',
      target: 'Password field',
      phase: 'steps',
      status: 'passed',
      durationMs: 900,
    },
    {
      index: 3,
      kind: 'type',
      verbatim: 'type "secret123"',
      target: 'Password field',
      phase: 'steps',
      status: 'passed',
      durationMs: 700,
    },
    {
      index: 4,
      kind: 'tap',
      verbatim: 'tap the Login button',
      target: 'Login button',
      phase: 'steps',
      status: 'passed',
      durationMs: 1100,
      message: 'Navigated to home screen',
    },
  ],
  phaseResults: [
    {
      phase: 'steps',
      success: true,
      stepsExecuted: 5,
      stepsTotal: 5,
    },
  ],
};

const mockFailedManifest: RunManifest = {
  runId: '20260705T110000-def',
  flowFile: 'sdk-run',
  specFile: 'tests/checkout.spec.ts',
  meta: {
    name: 'Checkout › completes purchase from search',
    description: 'Complete a purchase through the cart',
  },
  startedAt: isoOffset(3_600_000 + 60_000),
  finishedAt: isoOffset(3_600_000),
  durationMs: 60_000,
  platform: 'ios',
  device: 'iPhone 15 Pro',
  deviceVersion: 'iOS 17.2',
  success: false,
  stepsExecuted: 3,
  stepsTotal: 6,
  failedAt: 3,
  reason: 'Element "Add to Cart" not found after 10s',
  failedPhase: 'steps',
  steps: [
    {
      index: 0,
      kind: 'tap',
      verbatim: 'tap on the Search bar',
      target: 'Search bar',
      phase: 'steps',
      status: 'passed',
      durationMs: 1100,
    },
    {
      index: 1,
      kind: 'type',
      verbatim: 'type "headphones"',
      target: 'Search bar',
      phase: 'steps',
      status: 'passed',
      durationMs: 900,
    },
    {
      index: 2,
      kind: 'tap',
      verbatim: 'tap the first search result',
      target: 'Product item',
      phase: 'steps',
      status: 'passed',
      durationMs: 1300,
    },
    {
      index: 3,
      kind: 'tap',
      verbatim: 'tap the Add to Cart button',
      target: 'Add to Cart',
      phase: 'steps',
      status: 'failed',
      durationMs: 10_200,
      error: 'Element "Add to Cart" not found after 10s',
    },
    {
      index: 4,
      kind: 'tap',
      verbatim: 'tap the Cart icon',
      target: 'Cart icon',
      phase: 'steps',
      status: 'skipped',
      durationMs: 0,
    },
    {
      index: 5,
      kind: 'tap',
      verbatim: 'tap the Checkout button',
      target: 'Checkout button',
      phase: 'steps',
      status: 'skipped',
      durationMs: 0,
    },
  ],
  phaseResults: [
    {
      phase: 'steps',
      success: false,
      stepsExecuted: 3,
      stepsTotal: 6,
      failedAt: 3,
      reason: 'Element "Add to Cart" not found after 10s',
    },
  ],
  failureLogs: {
    appiumMcp: '[appium-mcp] INFO: Session started\n[appium-mcp] ERROR: findElement timeout',
  },
};

const SUITE_ID = 'suite-20260705T115500-preview';

const mockIndex: RunIndex = {
  schemaVersion: 1,
  generatedAt: NOW.toISOString(),
  runs: [
    {
      runId: mockManifest.runId,
      flowFile: mockManifest.flowFile,
      flowName: mockManifest.meta.name,
      platform: mockManifest.platform,
      startedAt: mockManifest.startedAt,
      durationMs: mockManifest.durationMs,
      success: true,
      stepsExecuted: 5,
      stepsTotal: 5,
      device: mockManifest.device,
      suiteId: SUITE_ID,
      suiteName: 'Smoke suite',
      specFile: 'tests/login.spec.ts',
    },
    {
      runId: mockFailedManifest.runId,
      flowFile: mockFailedManifest.flowFile,
      flowName: mockFailedManifest.meta.name,
      platform: mockFailedManifest.platform,
      startedAt: mockFailedManifest.startedAt,
      durationMs: mockFailedManifest.durationMs,
      success: false,
      stepsExecuted: 3,
      stepsTotal: 6,
      failedPhase: 'test',
      device: mockFailedManifest.device,
      suiteId: SUITE_ID,
      suiteName: 'Smoke suite',
      specFile: 'tests/checkout.spec.ts',
    },
    {
      runId: '20260704T090000-ghi',
      flowFile: 'sdk-run',
      flowName: 'Login › remembers me across relaunch',
      platform: 'android',
      startedAt: isoOffset(86_400_000),
      durationMs: 38_000,
      success: true,
      stepsExecuted: 5,
      stepsTotal: 5,
      device: 'Pixel 7',
      specFile: 'tests/login.spec.ts',
    },
    {
      runId: '20260703T150000-jkl',
      flowFile: 'sdk-run',
      flowName: 'Onboarding › first-time user completes tutorial',
      platform: 'ios',
      startedAt: isoOffset(172_800_000),
      durationMs: 120_000,
      success: true,
      stepsExecuted: 8,
      stepsTotal: 8,
      device: 'iPhone 15 Pro',
      specFile: 'tests/onboarding.spec.ts',
    },
  ],
  suites: [
    {
      suiteId: SUITE_ID,
      suiteName: 'Smoke suite',
      platform: 'android',
      startedAt: isoOffset(3_600_000 + 60_000),
      durationMs: 3_660_000,
      runIds: [mockManifest.runId, mockFailedManifest.runId],
      passedCount: 1,
      failedCount: 1,
    },
  ],
};

/* ─── Render & write ─────────────────────────────────────────── */

const indexHtml = renderIndexPage(mockIndex);
const runHtml = renderRunPage(mockManifest);
const failedRunHtml = renderRunPage(mockFailedManifest);

fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);
fs.writeFileSync(path.join(outDir, 'run.html'), runHtml);
fs.writeFileSync(path.join(outDir, 'run-failed.html'), failedRunHtml);

console.log(`✅  Preview written to ${outDir}/`);
console.log(`   index.html      — dashboard (${mockIndex.runs.length} runs)`);
console.log(`   run.html        — passing run detail`);
console.log(`   run-failed.html — failing run detail`);
