/**
 * JSON parse utilities with fallback strategies.
 *
 * @deprecated This module is no longer used — the agent now uses
 * generateText() with structured tool calling instead of parsing
 * raw JSON from generateObject().
 */

/** Try to parse raw JSON with multiple fallback strategies. */
export function parseJSON(raw: string): Record<string, unknown> | null {
  // Strategy 1: direct parse
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  // Strategy 2: extract JSON from markdown code block
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  // Strategy 3: find first { ... } in the text
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}
