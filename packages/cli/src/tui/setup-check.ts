/**
 * Config problems that stop a run before it starts.
 *
 * These used to be a `console.log` and a `process.exit(1)` fired before the Ink
 * app ever mounted — so the answer to `appclaw` was two grey lines above the
 * prompt, telling you what was wrong but not offering to fix it. The shell has
 * a settings screen that writes `.env`, so the same problem can be reported
 * *and* resolved without the user leaving, which is what SetupScreen does.
 *
 * Kept as data rather than thrown, because more than one thing can be wrong and
 * a list is more useful than the first failure.
 */

import type { AppClawConfig, ConfigIssue } from '@appclaw/core/config';

export interface SetupIssue {
  /** The offending config key, so the settings screen can jump to it. */
  key: string;
  title: string;
  detail: string;
}

/**
 * A rejected `.env` value, as something the setup screen can show.
 *
 * These used to escape as an unhandled ZodError with a stack trace, thrown from
 * core's import-time `loadConfig()` before the CLI had a `main()` to catch it.
 * The mapping is nearly free — zod already names the key and says what it
 * expected — and the shell can write `.env`, so this is exactly the kind of
 * problem it should be reporting rather than dying on.
 */
function fromConfigIssue(issue: ConfigIssue): SetupIssue {
  return {
    key: issue.key,
    title: `${issue.key} is not a value AppClaw accepts`,
    // zod's own message already names the value it got and the ones it wanted,
    // which is the whole of what a reader needs here.
    detail: issue.message,
  };
}

/**
 * Everything that would make a goal fail immediately.
 *
 * Deliberately narrow: this runs before any device or network call, so it can
 * only judge config. Anything needing a device belongs in `appclaw doctor`.
 *
 * `invalid` carries what zod rejected outright — passed in rather than
 * recomputed, because by the time this sees a config those values are already
 * gone, replaced by their schema defaults.
 */
export function collectSetupIssues(
  config: AppClawConfig,
  invalid: ConfigIssue[] = []
): SetupIssue[] {
  // Rejected values first: they are more fundamental than a missing key, and
  // the config carrying them has fallen back to defaults, so anything judged
  // below is being judged against values the user did not choose.
  const issues: SetupIssue[] = invalid.map(fromConfigIssue);

  // Ollama runs locally and authenticates nothing, so it is the one provider
  // for which a blank key is the correct state rather than a mistake.
  if (config.LLM_PROVIDER !== 'ollama' && !config.LLM_API_KEY) {
    issues.push({
      key: 'LLM_API_KEY',
      title: `No API key for ${config.LLM_PROVIDER}`,
      detail: 'Every goal needs one — the agent cannot plan or choose actions without it.',
    });
  }

  return issues;
}
