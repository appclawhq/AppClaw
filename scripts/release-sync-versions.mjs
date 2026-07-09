#!/usr/bin/env node
// Lockstep version sync for the @appclaw workspace.
//
// Usage: node scripts/release-sync-versions.mjs <version>
//
// Sets "version" in the root package.json and in EVERY workspace member (from
// the root "workspaces" field — packages/* and the examples) to <version>, and
// rewrites any dependencies/devDependencies/peerDependencies entry whose key
// starts with "@appclaw/" to that exact <version> (so internal workspace links
// move in lockstep on release — including the private examples that consume the
// packages locally, which keeps them resolvable after a version bump). Files are
// written back with 2-space indentation and a trailing newline.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release-sync-versions.mjs <version>');
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

/**
 * Collect the package.json files to update: root + every workspace member,
 * derived from the root "workspaces" field. A `dir/*` pattern is expanded by
 * scanning its immediate subdirs; any other entry is treated as a literal path.
 */
function collectPackageJsonPaths() {
  const paths = [join(repoRoot, 'package.json')];
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const patterns = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : [];
  const addIfPkg = (pkgPath) => {
    if (existsSync(pkgPath) && statSync(pkgPath).isFile()) paths.push(pkgPath);
  };
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const dir = join(repoRoot, pattern.slice(0, -2));
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir).sort()) {
        addIfPkg(join(dir, entry, 'package.json'));
      }
    } else {
      addIfPkg(join(repoRoot, pattern, 'package.json'));
    }
  }
  return paths;
}

const pkgPaths = collectPackageJsonPaths();

// The set of INTERNAL workspace package names. We only rewrite deps that point
// at one of these — external @appclaw/* packages (e.g. @appclaw/vision, which
// lives in its own repo and versions independently) must keep their own ranges.
const internalNames = new Set();
for (const pkgPath of pkgPaths) {
  const name = JSON.parse(readFileSync(pkgPath, 'utf8')).name;
  if (name) internalNames.add(name);
}

/** Rewrite internal workspace-package keys in a dependency map to the exact version. */
function syncScopedDeps(deps) {
  let changed = 0;
  if (!deps || typeof deps !== 'object') return changed;
  for (const key of Object.keys(deps)) {
    if (internalNames.has(key) && deps[key] !== version) {
      deps[key] = version;
      changed += 1;
    }
  }
  return changed;
}

for (const pkgPath of pkgPaths) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  pkg.version = version;
  let depChanges = 0;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    depChanges += syncScopedDeps(pkg[field]);
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(
    `synced ${pkg.name ?? pkgPath} -> ${version}` +
      (depChanges ? ` (${depChanges} internal dep${depChanges === 1 ? '' : 's'})` : '')
  );
}
