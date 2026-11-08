/**
 * Asks Google Flow for a clip that speaks the scene's Thai voiceover line (owner choice 2026-11-08:
 * the clips carry the voice). Flow's video model takes spoken lines from the prompt; whether it
 * speaks good Thai is only known from the owner's real run, so this stays a tunable sentence.
 */
export const SPOKEN_LINE_TEMPLATE =
  'Audio: a friendly Thai narrator says, clearly and naturally, in Thai: "{line}". Soft background music, no other speech.';

/** Straight quotes inside the line would end the quoted text early; line breaks become spaces. */
function cleanLine(line: string): string {
  return line.replace(/["“”]/g, "'").replace(/\s+/g, ' ').trim();
}

/** The Flow prompt with the spoken line added, or the prompt unchanged when there is no line. */
export function withSpokenLine(prompt: string, voiceover: string | null | undefined): string {
  const line = cleanLine(voiceover ?? '');
  if (line === '') return prompt;
  return `${prompt.trim()} ${SPOKEN_LINE_TEMPLATE.replace('{line}', line)}`;
}
