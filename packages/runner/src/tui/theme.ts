/**
 * Ink theme for the runner dashboard — color palette and symbols.
 *
 * Vendored copy of the CLI's `ui/ink/theme.ts` palette (kept local so the
 * runner package has no dependency on @appclaw/cli). Values must stay in sync
 * with the CLI theme so the runner and interactive UIs render identically.
 */

export const COLORS = {
  brand: '#FC8EAC', // primary / focus (AppClaw flamingo pink)
  step: '#9CC6F5', // step accent (blue)
  cyan: '#00d4ff',
  green: '#22C55E',
  greenDim: '#2d8a4e',
  yellow: '#f0c040',
  red: '#ef4444',
  redDim: '#a33',
  label: '#9CA3AF',
  dimmed: '#666666',
  muted: '#444444',
  white: '#e6e6e6',
} as const;

export const symbols = {
  check: '✓',
  cross: '✗',
  warning: '⚠',
  diamond: '◆',
  circle: '●',
  circleEmpty: '○',
  arrow: '→',
  arrowDown: '↳',
  ellipsis: '…',
  dot: '·',
  pipe: '│',
  bar: '┃',
  prompt: '❯',
} as const;
