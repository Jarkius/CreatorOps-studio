/**
 * Thai subtitles for the final video (D-086). libass only breaks lines at spaces and Thai has none
 * between words, so lines are wrapped here at word boundaries (Intl.Segmenter knows Thai words).
 * The text comes from a model, so anything libass would read as a command is neutralised.
 */

export interface SubtitleCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** Characters per line before a break; about what fits across 1080 px at the chosen size. */
export const MAX_LINE_CHARS = 22;
const MAX_LINES = 3;

/** Removes ASS override blocks and escapes, and folds every kind of line break into a space. */
export function cleanText(text: string): string {
  return text
    .replace(/[{}]/g, '')
    .replace(/\\/g, '/')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Visible length: combining marks (Thai vowels above and below, tone marks) add nothing. */
function visibleLength(text: string): number {
  return text.replace(/\p{M}/gu, '').length;
}

/** Splits into lines at word boundaries (spaces or Thai words), at most MAX_LINES lines. */
export function wrapLines(text: string, maxChars = MAX_LINE_CHARS): string[] {
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  const lines: string[] = [];
  let current = '';
  for (const { segment } of segmenter.segment(cleanText(text))) {
    const next = current + segment;
    if (current !== '' && visibleLength(next.trim()) > maxChars) {
      lines.push(current.trim());
      current = segment.trimStart();
    } else {
      current = next;
    }
  }
  if (current.trim() !== '') lines.push(current.trim());
  if (lines.length <= MAX_LINES) return lines;
  const kept = lines.slice(0, MAX_LINES);
  kept[MAX_LINES - 1] = `${kept[MAX_LINES - 1]}…`;
  return kept;
}

function assTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10));
  const cs = total % 100;
  const s = Math.floor(total / 100) % 60;
  const m = Math.floor(total / 6000) % 60;
  const h = Math.floor(total / 360000);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor(t / 60_000) % 60;
  const s = Math.floor(t / 1000) % 60;
  const milli = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

/** An ASS script for a 1080x1920 video: bottom centre, white with a dark outline. */
export function buildAss(cues: readonly SubtitleCue[], fontName: string): string {
  const font = cleanText(fontName).replace(/,/g, ' ') || 'Sans';
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,4,1,2,60,60,260,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = cues
    .filter((cue) => cue.endMs > cue.startMs && cleanText(cue.text) !== '')
    .map(
      (cue) =>
        `Dialogue: 0,${assTime(cue.startMs)},${assTime(cue.endMs)},Default,,0,0,0,,${wrapLines(cue.text).join('\\N')}`,
    );
  return `${[...header, ...events].join('\n')}\n`;
}

/** The same cues as an .srt file, for editors that add their own subtitles. */
export function buildSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .filter((cue) => cue.endMs > cue.startMs && cleanText(cue.text) !== '')
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${wrapLines(cue.text).join('\n')}\n`,
    )
    .join('\n');
}

/** One cue per clip, shown for the whole clip. */
export function cuesFor(
  clips: readonly { readonly durationMs: number; readonly voiceover: string | null }[],
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  let at = 0;
  for (const clip of clips) {
    if (clip.voiceover !== null && cleanText(clip.voiceover) !== '') {
      cues.push({ startMs: at, endMs: at + clip.durationMs, text: clip.voiceover });
    }
    at += clip.durationMs;
  }
  return cues;
}
