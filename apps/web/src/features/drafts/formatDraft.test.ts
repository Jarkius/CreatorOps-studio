import { describe, expect, it } from 'vitest';

import type { DraftSections } from '@creatorops/contracts';

import { formatDraftForCopy, formatSectionForCopy } from './formatDraft.js';

// "ที่ น้ำ" with its combining marks as typed (Sara Am, tone marks) and a space between words.
const SECTIONS: DraftSections = {
  title: 'พัดลมตั้งโต๊ะ Desk Fan ลมเย็นสบาย',
  hook: 'ร้อนแบบนี้ ต้องมีพัดลมที่ น้ำหนักเบา',
  script: 'เปิดด้วยการใช้งานจริง แล้วแสดงระดับลม',
  storyboard: ['ฉากที่ 1: วางพัดลมบนโต๊ะ', 'ฉากที่ 2: ปรับระดับลม'],
  caption: 'พัดลมตั้งโต๊ะ ลมเย็น เสียงเบา',
  hashtags: ['#พัดลม', '#DeskFan'],
  callToAction: 'กดดูรายละเอียดสินค้า',
};

describe('formatSectionForCopy', () => {
  it('returns text sections exactly as stored, with Thai combining marks intact', () => {
    expect(formatSectionForCopy('hook', SECTIONS)).toBe(SECTIONS.hook);
    expect(formatSectionForCopy('title', SECTIONS)).toBe(SECTIONS.title);
    expect(formatSectionForCopy('callToAction', SECTIONS)).toBe(SECTIONS.callToAction);
    expect(formatSectionForCopy('hook', SECTIONS)).toContain('ที่ น้ำหนักเบา');
  });

  it('numbers storyboard scenes, one per line', () => {
    expect(formatSectionForCopy('storyboard', SECTIONS)).toBe(
      '1. ฉากที่ 1: วางพัดลมบนโต๊ะ\n2. ฉากที่ 2: ปรับระดับลม',
    );
  });

  it('joins hashtags by a single space', () => {
    expect(formatSectionForCopy('hashtags', SECTIONS)).toBe('#พัดลม #DeskFan');
  });

  it('returns an empty string for an empty hashtag list', () => {
    expect(formatSectionForCopy('hashtags', { ...SECTIONS, hashtags: [] })).toBe('');
  });
});

describe('formatDraftForCopy', () => {
  it('writes the sections in the fixed order, each under its heading, separated by a blank line', () => {
    const expected = [
      'Title',
      SECTIONS.title,
      '',
      'Hook',
      SECTIONS.hook,
      '',
      'Script',
      SECTIONS.script,
      '',
      'Storyboard',
      '1. ฉากที่ 1: วางพัดลมบนโต๊ะ',
      '2. ฉากที่ 2: ปรับระดับลม',
      '',
      'Caption',
      SECTIONS.caption,
      '',
      'Hashtags',
      '#พัดลม #DeskFan',
      '',
      'Call to action',
      SECTIONS.callToAction,
    ].join('\n');
    expect(formatDraftForCopy(SECTIONS)).toBe(expected);
  });

  it('does not alter any Thai character (the output keeps the stored code points)', () => {
    const output = formatDraftForCopy(SECTIONS);
    expect(output).toContain(SECTIONS.hook);
    expect(output).toContain(SECTIONS.title);
    expect(Array.from(output.normalize('NFC')).length).toBe(Array.from(output).length);
    expect(output.includes('ที่ น้ำหนักเบา')).toBe(true);
  });
});
