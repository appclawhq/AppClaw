#!/usr/bin/env node

// `appclaw-runner [filter...] [options]` — the AppClaw test runner CLI.
//
// Spec/config files (appclaw.config.ts, *.spec.ts) are TypeScript, loaded via
// dynamic import() inside the runner. Node can't import .ts directly, so we
// register a TS loader (tsx) here before the runner runs. This lets a plain
// `appclaw-runner` work from a package.json script — no `tsx` wrapper needed.
// Pre-compiled `.js` specs work without it.
await registerTsLoader();
const { runCli } = await import('../dist/cli.js');
const code = await runCli(process.argv.slice(2), { programName: 'appclaw-runner' });
process.exit(code);

/** Register tsx's ESM loader so later `import()` of `.ts` files resolves. */
async function registerTsLoader() {
  try {
    const { register } = await import('tsx/esm/api');
    register();
  } catch {
    // tsx isn't installed in this project. TypeScript specs will fail to load;
    // hint how to fix it. JavaScript specs still run fine, so don't hard-exit.
    process.stderr.write(
      'appclaw-runner: TypeScript specs need a TS loader. Run `npm i -D tsx`\n' +
        '                (or compile specs to .js, or invoke via `tsx`).\n'
    );
  }
}
