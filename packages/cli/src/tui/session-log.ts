/**
 * JSON session log for `appclaw --tui`.
 *
 * A TUI session is a recording session: the user types instructions, each runs
 * on the device and appends a step. The log is that history in machine-readable
 * form — what was typed, what it resolved to, whether it worked, how long it
 * took — so a session can be reviewed, diffed or turned into a flow after the
 * fact, not just while the transcript is still on screen.
 *
 * Deliberately NOT reusing `RunManifest` from the report writer: that type is
 * built around a YAML flow file (`flowFile`, `stepsTotal` known up front) and a
 * REPL session has neither, so it could only be stored by inventing values.
 *
 * The file is rewritten after every event rather than appended once at the end,
 * because the most interesting sessions are the ones that end in a crash or a
 * kill — a log that only exists on a clean exit would miss them.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FlowStep, FlowMeta } from '@appclaw/core/flow/types';

export type SessionEventKind = 'instruction' | 'goal' | 'command' | 'export' | 'error';

export interface SessionEvent {
  at: string;
  kind: SessionEventKind;
  /** Exactly what the user typed. */
  input: string;
  ok?: boolean;
  message?: string;
  durationMs?: number;
  /** The step this instruction recorded, when it recorded one. */
  step?: FlowStep;
}

export interface SessionLogData {
  sessionId: string;
  startedAt: string;
  finishedAt?: string;
  platform?: string;
  device?: { name: string; udid: string };
  llm?: { provider: string; model: string; mode: string };
  events: SessionEvent[];
  /** The recorded flow as it stood when the session ended. */
  steps: FlowStep[];
  meta: FlowMeta;
  /** Paths written by /export during the session. */
  exports: string[];
}

/** `20260825T124312-4f2` — sorts chronologically, unique enough per session. */
function newSessionId(now: Date, random: number): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '');
  const suffix = Math.floor(random * 0xfff)
    .toString(16)
    .padStart(3, '0');
  return `${stamp}-${suffix}`;
}

export interface SessionLog {
  readonly path: string;
  setDevice(platform: string, device: { name: string; udid: string }): void;
  setLlm(provider: string, model: string, mode: string): void;
  record(event: Omit<SessionEvent, 'at'>): void;
  /** Mirror the recorded flow, which /undo, /edit and /clear can mutate after the fact. */
  setFlow(steps: FlowStep[], meta: FlowMeta): void;
  addExport(filePath: string): void;
  finish(): void;
}

/**
 * The active session's log. A module-level holder so command handlers can
 * append to it without `TuiActions` growing a method per event type.
 */
let current: SessionLog | null = null;

export function setCurrentSessionLog(log: SessionLog | null): void {
  current = log;
}

export function currentSessionLog(): SessionLog | null {
  return current;
}

export function createSessionLog(projectRoot: string, now = new Date()): SessionLog {
  const sessionId = newSessionId(now, Math.random());
  const dir = path.join(projectRoot, '.appclaw', 'sessions');
  const file = path.join(dir, `${sessionId}.json`);

  const data: SessionLogData = {
    sessionId,
    startedAt: now.toISOString(),
    events: [],
    steps: [],
    meta: {},
    exports: [],
  };

  let failed = false;

  function flush(): void {
    // A logging failure must never take the session down with it — report once
    // and then stay quiet rather than throwing on every subsequent event.
    if (failed) return;
    try {
      mkdirSync(dir, { recursive: true });
      // Write-then-rename: a kill midway through leaves the previous complete
      // file rather than a truncated one.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
      renameSync(tmp, file);
    } catch {
      failed = true;
    }
  }

  flush();

  return {
    path: file,
    setDevice(platform, device) {
      data.platform = platform;
      data.device = device;
      flush();
    },
    setLlm(provider, model, mode) {
      data.llm = { provider, model, mode };
      flush();
    },
    record(event) {
      data.events.push({ at: new Date().toISOString(), ...event });
      flush();
    },
    setFlow(steps, meta) {
      data.steps = steps;
      data.meta = meta;
      flush();
    },
    addExport(filePath) {
      data.exports.push(filePath);
      flush();
    },
    finish() {
      data.finishedAt = new Date().toISOString();
      flush();
    },
  };
}

export const SESSIONS_DIRNAME = path.join('.appclaw', 'sessions');

/**
 * Every readable session log, newest first.
 *
 * A malformed or half-written file is skipped rather than failing the whole
 * listing: the log is rewritten live, so the session currently running can be
 * read mid-write, and one bad file shouldn't hide every other session.
 */
export async function listSessions(projectRoot: string): Promise<SessionLogData[]> {
  const dir = path.join(projectRoot, SESSIONS_DIRNAME);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return []; // no sessions yet
  }

  const sessions = await Promise.all(
    names
      .filter((n) => n.endsWith('.json'))
      .map(async (name) => {
        try {
          const raw = await readFile(path.join(dir, name), 'utf-8');
          const parsed = JSON.parse(raw) as SessionLogData;
          return parsed && typeof parsed.sessionId === 'string' ? parsed : null;
        } catch {
          return null;
        }
      })
  );

  return sessions
    .filter((s): s is SessionLogData => s !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/** Did every recorded instruction in this session succeed? */
export function sessionSucceeded(session: SessionLogData): boolean {
  return !session.events.some((e) => e.ok === false);
}
