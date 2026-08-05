/**
 * VariableResolver — resolves `${variables.X}` and `${secrets.X}` placeholders
 * in flow step strings.
 *
 * - **Secrets** (`${secrets.X}`) are resolved directly from `process.env[X]`
 *   at runtime. They are never stored in YAML or env files.
 * - **Variables** (`${variables.X}`) are loaded from `.appclaw/env/<name>.yaml`
 *   files or inline `env:` blocks in the YAML header.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { parse as parseYaml } from 'yaml';

// ── Types ──────────────────────────────────────────────────────────

export interface VariableBindings {
  variables: Record<string, string | number | boolean>;
}

export interface ResolveResult {
  resolved: string;
  redacted: string;
  sensitiveValues: string[];
}

// ── Loading ────────────────────────────────────────────────────────

/**
 * Load an environment YAML file and return variable bindings.
 *
 * Expected YAML shape:
 * ```yaml
 * variables:
 *   locale: en-US
 *   timeout: 30
 *   app_name: youtube
 * ```
 */
export function loadEnvironmentFile(filePath: string): VariableBindings {
  if (!existsSync(filePath)) {
    throw new Error(`Environment file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  const doc = parseYaml(raw);

  if (!doc || typeof doc !== 'object') {
    throw new Error(`Environment file must be a YAML object: ${filePath}`);
  }

  const bindings: VariableBindings = { variables: {} };

  if (doc.variables && typeof doc.variables === 'object') {
    for (const [key, val] of Object.entries(doc.variables)) {
      if (val === null || val === undefined) continue;
      bindings.variables[key] = val as string | number | boolean;
    }
  }

  return bindings;
}

/**
 * Build bindings from inline `env:` block in the YAML header.
 */
export function loadInlineBindings(env: Record<string, unknown>): VariableBindings {
  const bindings: VariableBindings = { variables: {} };

  if (env.variables && typeof env.variables === 'object') {
    for (const [key, val] of Object.entries(env.variables as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      bindings.variables[key] = val as string | number | boolean;
    }
  }

  return bindings;
}

// ── Merging ────────────────────────────────────────────────────────

/** Merge two bindings, with `override` taking precedence. */
export function mergeBindings(
  base: VariableBindings,
  override: VariableBindings
): VariableBindings {
  return {
    variables: { ...base.variables, ...override.variables },
  };
}

/** Empty bindings — no variables. */
export function emptyBindings(): VariableBindings {
  return { variables: {} };
}

// ── Interpolation ──────────────────────────────────────────────────

const PLACEHOLDER_RE = /\$\{(secrets|variables)\.([^}]+)\}/g;

/**
 * Interpolate `${secrets.X}` and `${variables.X}` placeholders in a string.
 *
 * - **secrets** are resolved directly from `process.env[X]` at runtime.
 * - **variables** are resolved from the provided bindings (env YAML files).
 *
 * Returns both the resolved string and a redacted version (secrets replaced with `***`).
 * Throws if a referenced binding is not found.
 */
export function interpolate(template: string, bindings: VariableBindings): ResolveResult {
  let resolved = template;
  let redacted = template;
  const sensitiveValues = new Set<string>();

  resolved = resolved.replace(PLACEHOLDER_RE, (_match, scope: string, key: string) => {
    if (scope === 'secrets') {
      const value = process.env[key];
      if (value === undefined) {
        throw new Error(
          `Undefined secret: "\${secrets.${key}}". ` +
            `Set the environment variable "${key}" in your shell or .env file.`
        );
      }
      if (value) sensitiveValues.add(value);
      return value;
    }
    if (!(key in bindings.variables)) {
      throw new Error(
        `Undefined variable: "\${variables.${key}}". Define it in your environment file.`
      );
    }
    return String(bindings.variables[key]);
  });

  redacted = redacted.replace(PLACEHOLDER_RE, (_match, scope: string, key: string) => {
    if (scope === 'secrets') return '***';
    if (scope === 'variables' && key in bindings.variables) {
      return String(bindings.variables[key]);
    }
    return _match;
  });

  return { resolved, redacted, sensitiveValues: [...sensitiveValues] };
}

/** Replace resolved secret values in any user-visible string. */
export function redactSensitiveValues(text: string, sensitiveValues?: string[]): string {
  if (!sensitiveValues?.length) return text;
  return [...new Set(sensitiveValues)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .reduce((redacted, value) => redacted.split(value).join('***'), text);
}

/** Recursively redact resolved secrets from report- or log-shaped data. */
export function redactSensitiveData<T>(value: T, sensitiveValues?: string[]): T {
  if (!sensitiveValues?.length) return value;
  if (typeof value === 'string') {
    return redactSensitiveValues(value, sensitiveValues) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, sensitiveValues)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        redactSensitiveData(nested, sensitiveValues),
      ])
    ) as T;
  }
  return value;
}

/**
 * Check whether a string contains any `${secrets.X}` or `${variables.X}` placeholders.
 * Uses a fresh regex to avoid lastIndex issues with the global flag.
 */
export function hasPlaceholders(text: string): boolean {
  return /\$\{(secrets|variables)\.[^}]+\}/.test(text);
}

/**
 * Interpolate all string fields of a FlowStep, returning a new step with resolved values
 * and keeping track of the redacted verbatim for display.
 */
export function interpolateStep<T extends Record<string, unknown>>(
  step: T,
  bindings: VariableBindings
): T & { sensitive?: boolean; sensitiveValues?: string[] } {
  const containsPlaceholder = (value: unknown): boolean => {
    if (typeof value === 'string') return hasPlaceholders(value);
    if (Array.isArray(value)) return value.some(containsPlaceholder);
    if (value && typeof value === 'object') return Object.values(value).some(containsPlaceholder);
    return false;
  };
  if (!containsPlaceholder(step)) {
    return step;
  }
  const containsSecret = (value: unknown): boolean => {
    if (typeof value === 'string') return /\$\{secrets\.[^}]+\}/.test(value);
    if (Array.isArray(value)) return value.some(containsSecret);
    if (value && typeof value === 'object') return Object.values(value).some(containsSecret);
    return false;
  };
  const sensitive = containsSecret(step);
  const sensitiveValues = new Set<string>();

  const resolveNested = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!hasPlaceholders(value)) return value;
      const result = interpolate(value, bindings);
      for (const secretValue of result.sensitiveValues) sensitiveValues.add(secretValue);
      return result.resolved;
    }
    if (Array.isArray(value)) return value.map(resolveNested);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key,
          resolveNested(nested),
        ])
      );
    }
    return value;
  };

  const result = resolveNested(step) as T;
  if (sensitive) {
    (result as Record<string, unknown>).sensitive = true;
    (result as Record<string, unknown>).sensitiveValues = [...sensitiveValues];
  }

  // Keep the user-facing natural-language instruction redacted.
  if (typeof step.verbatim === 'string' && hasPlaceholders(step.verbatim)) {
    (result as Record<string, unknown>).verbatim = interpolate(step.verbatim, bindings).redacted;
  }

  return result;
}
