import { describe, expect, it } from 'vitest';

import type { DraftSections } from '@creatorops/contracts';

import { isSameSectionValue, parseSectionText, toEditorText } from './sectionEdit.js';

const SECTIONS: DraftSections = {
  title: 'พัดลมตั้งโต๊ะ',
  hook: 'ร้อนแบบนี้ ต้องมีพัดลมที่ น้ำหนักเบา',
  script: 'เปิดด้วยการใช้งานจริง',
  storyboard: ['ฉากที่ 1: วางพัดลม', 'ฉากที่ 2: ปรับระดับลม'],
  caption: 'พัดลมตั้งโต๊ะ ลมเย็น',
  hashtags: ['#พัดลม', '#DeskFan'],
  callToAction: 'กดดูรายละเอียดสินค้า',
};

describe('parseSectionText: text sections', () => {
  it('trims the text', () => {
    expect(parseSectionText('title', '  พัดลม Desk Fan  ')).toEqual({
      ok: true,
      value: 'พัดลม Desk Fan',
    });
  });

  it('refuses an empty or spaces-only text', () => {
    expect(parseSectionText('hook', '   ')).toEqual({ ok: false, message: 'Cannot be empty' });
    expect(parseSectionText('callToAction', '')).toEqual({
      ok: false,
      message: 'Cannot be empty',
    });
  });

  it('accepts exactly the maximum and refuses one more character', () => {
    expect(parseSectionText('title', 'ก'.repeat(100))).toMatchObject({ ok: true });
    expect(parseSectionText('title', 'ก'.repeat(101))).toEqual({
      ok: false,
      message: 'Too long (max 100)',
    });
  });
});

describe('parseSectionText: storyboard', () => {
  it('keeps one scene per line and drops blank lines', () => {
    expect(parseSectionText('storyboard', 'ฉาก 1\n\n   \nฉาก 2\r\n')).toEqual({
      ok: true,
      value: ['ฉาก 1', 'ฉาก 2'],
    });
  });

  it('refuses no scenes', () => {
    expect(parseSectionText('storyboard', '\n  \n')).toEqual({
      ok: false,
      message: 'Cannot be empty',
    });
  });

  it('refuses more than 12 scenes', () => {
    const thirteen = Array.from({ length: 13 }, (_, index) => `ฉาก ${index + 1}`).join('\n');
    expect(parseSectionText('storyboard', thirteen)).toEqual({
      ok: false,
      message: 'Too many scenes (max 12)',
    });
  });

  it('refuses a scene longer than 300 characters and names its number', () => {
    const text = `ฉาก 1\n${'ก'.repeat(301)}`;
    expect(parseSectionText('storyboard', text)).toEqual({
      ok: false,
      message: 'Scene 2 is too long (max 300)',
    });
  });
});

describe('parseSectionText: hashtags', () => {
  it('splits on spaces and commas and adds a # where it is missing', () => {
    expect(parseSectionText('hashtags', 'พัดลม, DeskFan  #ลม')).toEqual({
      ok: true,
      value: ['#พัดลม', '#DeskFan', '#ลม'],
    });
  });

  it('drops empty tokens and a lone #', () => {
    expect(parseSectionText('hashtags', ' , # ,, #DeskFan ')).toEqual({
      ok: true,
      value: ['#DeskFan'],
    });
  });

  it('allows an empty list', () => {
    expect(parseSectionText('hashtags', '   ')).toEqual({ ok: true, value: [] });
  });

  it('refuses more than 30 tags', () => {
    const thirtyOne = Array.from({ length: 31 }, (_, index) => `tag${index}`).join(' ');
    expect(parseSectionText('hashtags', thirtyOne)).toEqual({
      ok: false,
      message: 'Too many hashtags (max 30)',
    });
  });

  it('refuses a tag longer than 50 characters and names its number', () => {
    expect(parseSectionText('hashtags', `#ok ${'a'.repeat(50)}`)).toEqual({
      ok: false,
      message: 'Hashtag 2 is too long (max 50)',
    });
  });
});

describe('toEditorText', () => {
  it('shows one scene per line and hashtags separated by spaces', () => {
    expect(toEditorText('storyboard', SECTIONS)).toBe('ฉากที่ 1: วางพัดลม\nฉากที่ 2: ปรับระดับลม');
    expect(toEditorText('hashtags', SECTIONS)).toBe('#พัดลม #DeskFan');
  });

  it('returns text sections unchanged', () => {
    expect(toEditorText('hook', SECTIONS)).toBe(SECTIONS.hook);
  });

  it('round-trips through parseSectionText', () => {
    const storyboard = parseSectionText('storyboard', toEditorText('storyboard', SECTIONS));
    const hashtags = parseSectionText('hashtags', toEditorText('hashtags', SECTIONS));
    expect(storyboard).toEqual({ ok: true, value: SECTIONS.storyboard });
    expect(hashtags).toEqual({ ok: true, value: SECTIONS.hashtags });
  });
});

describe('isSameSectionValue', () => {
  it('compares arrays in order', () => {
    expect(isSameSectionValue(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSameSectionValue(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(isSameSectionValue('ที่ น้ำ', 'ที่ น้ำ')).toBe(true);
  });
});
