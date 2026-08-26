/**
 * `/memory` inspector — episodic + procedural memory stats/listing.
 *
 * Reads only Config + the on-disk stores, so any surface can expose the same
 * command. Output stays plain console.log, but the TUI captures it and renders
 * it inside `OutputDialog` — a box far narrower than the terminal. So no line
 * here may be sized to the terminal width: a full-width rule wrapped inside the
 * box and came out as a second, stray underline. Section headings are plain
 * text for that reason.
 */

import { Config } from '@appclaw/core/config';
import { theme } from '@appclaw/core/ui/terminal';
import { loadStore, getTrajectoryStorePath } from '@appclaw/core/memory/store';
import { loadProcedures, getProceduresStorePath } from '@appclaw/core/memory/procedures';

export function runMemoryCommand(arg: string): void {
  const sub = (arg || 'stats').toLowerCase();
  if (sub === 'stats') return printMemoryStats();
  if (sub === 'list') return printMemoryProcedureList();
  if (sub === 'paths') return printMemoryPaths();
  console.log(`  ${theme.label('Usage:')} /memory stats  |  /memory list  |  /memory paths`);
}

function printMemoryPaths(): void {
  const trajPath = getTrajectoryStorePath(Config.EPISODIC_MEMORY_PATH || undefined);
  const procPath = getProceduresStorePath(Config.PROCEDURAL_MEMORY_PATH || undefined);
  console.log(`  ${theme.label('Trajectories:')} ${theme.white(trajPath)}`);
  console.log(`  ${theme.label('Procedures:  ')} ${theme.white(procPath)}`);
  console.log(`  ${theme.label('Namespace:   ')} ${theme.white(Config.APPCLAW_MEMORY_NAMESPACE)}`);
}

function printMemoryStats(): void {
  const trajPath = getTrajectoryStorePath(Config.EPISODIC_MEMORY_PATH || undefined);
  const procPath = getProceduresStorePath(Config.PROCEDURAL_MEMORY_PATH || undefined);
  const trajStore = loadStore(Config.EPISODIC_MEMORY_PATH || undefined);
  const procStore = loadProcedures(Config.PROCEDURAL_MEMORY_PATH || undefined);
  const ns = Config.APPCLAW_MEMORY_NAMESPACE;

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const trajNs = trajStore.entries.filter((e) => (e.namespace ?? 'default') === ns);
  const procNs = procStore.entries.filter((e) => e.namespace === ns);
  const trajStale = trajNs.filter(
    (e) => e.successCount < 2 && Date.now() - e.timestamp > SEVEN_DAYS
  ).length;

  const groupByApp = <T extends { appId: string }>(arr: T[]): Array<[string, number]> => {
    const m = new Map<string, number>();
    for (const e of arr) m.set(e.appId, (m.get(e.appId) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log(`  ${theme.label('Memory stats')}`);
  console.log();
  console.log(`  ${theme.label('Namespace:')} ${theme.white(ns)}`);
  console.log();

  // Episodic
  console.log(
    `  ${theme.label('Episodic')}  ${theme.dim(`(${trajPath})`)}\n` +
      `    ${theme.label('Total:')}      ${theme.white(String(trajStore.entries.length))}` +
      `  ${theme.dim(`(${trajNs.length} in this namespace)`)}\n` +
      `    ${theme.label('Stale-eligible:')} ${theme.white(String(trajStale))} ${theme.dim('(single-use, >7d — hidden from retrieval)')}`
  );
  const trajByApp = groupByApp(trajNs);
  if (trajByApp.length > 0) {
    console.log(`    ${theme.label('By app:')}`);
    for (const [appId, n] of trajByApp.slice(0, 8)) {
      console.log(
        `      ${theme.dim('•')} ${theme.white(appId.padEnd(40))} ${theme.dim(String(n))}`
      );
    }
  }
  console.log();

  // Procedural
  console.log(
    `  ${theme.label('Procedural')}  ${theme.dim(`(${procPath})`)}\n` +
      `    ${theme.label('Total:')} ${theme.white(String(procStore.entries.length))}` +
      `  ${theme.dim(`(${procNs.length} in this namespace)`)}`
  );
  const procByApp = groupByApp(procNs);
  if (procByApp.length > 0) {
    console.log(`    ${theme.label('By app:')}`);
    for (const [appId, n] of procByApp.slice(0, 8)) {
      console.log(
        `      ${theme.dim('•')} ${theme.white(appId.padEnd(40))} ${theme.dim(String(n))}`
      );
    }
  }
  console.log();
  console.log(theme.dim(`  Type /memory list to see goal recipes, /memory paths for file paths.`));
}

function printMemoryProcedureList(): void {
  const store = loadProcedures(Config.PROCEDURAL_MEMORY_PATH || undefined);
  const ns = Config.APPCLAW_MEMORY_NAMESPACE;
  const items = store.entries.filter((e) => e.namespace === ns);

  if (items.length === 0) {
    console.log(
      `  ${theme.dim(`No procedures yet in namespace "${ns}". Run a goal to record one.`)}`
    );
    return;
  }

  items.sort((a, b) => b.timestamp - a.timestamp);

  console.log(`  ${theme.label('Procedures')} ${theme.dim(`(${items.length} in "${ns}")`)}`);
  console.log();
  for (const p of items.slice(0, 20)) {
    const ago = formatProcAgo(p.timestamp);
    const goal = p.goalKeywords.join(' ');
    const reuse = p.successCount > 1 ? ` ${theme.success(`×${p.successCount}`)}` : '';
    console.log(
      `  ${theme.dim('•')} ${theme.white(goal)}${reuse}` +
        ` ${theme.dim(`— ${p.appId}, ${p.steps.length} steps, ${ago}`)}`
    );
  }
}

function formatProcAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
