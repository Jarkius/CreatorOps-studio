import { describe, expect, it } from 'vitest';

import { withSpokenLine } from './flowSpeech.js';

describe('withSpokenLine', () => {
  it('adds the Thai line as speech after the prompt', () => {
    expect(withSpokenLine('Vertical 9:16 video. A lamp on a desk.', 'แนะนำโคมไฟถนอมสายตา')).toBe(
      'Vertical 9:16 video. A lamp on a desk. Audio: a friendly Thai narrator says, clearly and naturally, in Thai: "แนะนำโคมไฟถนอมสายตา". Soft background music, no other speech.',
    );
  });
  it('keeps quotes and line breaks in the line from breaking the prompt', () => {
    expect(withSpokenLine('P.', 'ลอง "ใช้" ดู\nนะ')).toContain('in Thai: "ลอง \'ใช้\' ดู นะ".');
  });
  it('leaves the prompt alone without a line', () => {
    expect(withSpokenLine('P.', '')).toBe('P.');
    expect(withSpokenLine('P.', '   ')).toBe('P.');
    expect(withSpokenLine('P.', null)).toBe('P.');
  });
});
