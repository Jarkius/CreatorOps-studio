import type { DiagnosticLine, MetaAiErrorCode } from './runner.js';

/**
 * The text behind "Copy diagnostics". It lists the steps with timings and what the helper found
 * on the page (title, path, which selector matched, counts). It holds no cookies, tokens, page
 * text, addresses with queries, prompts or generated content.
 */
export function formatDiagnostics(
  lines: readonly DiagnosticLine[],
  outcome: { readonly code: MetaAiErrorCode | 'OK' | 'UNKNOWN'; readonly scene: string },
  at: Date,
): string {
  return [
    'CreatorOps Meta AI helper diagnostics',
    `time: ${at.toISOString()}`,
    `scene: ${outcome.scene}`,
    `result: ${outcome.code}`,
    '',
    ...lines.map((line) => `+${(line.atMs / 1000).toFixed(1)}s [${line.step}] ${line.note}`),
  ].join('\n');
}
