import { describe, expect, it } from 'vitest';

import type { ExportInput, ExportMediaInput } from './input.js';
import { buildPackage, formatChecklist, mediaEntryName } from './package.js';

const SHA = 'a'.repeat(64);
const media = (overrides: Partial<ExportMediaInput> = {}): ExportMediaInput => ({
  assetId: 'asset-1',
  role: 'media',
  scene: null,
  aiGenerated: false,
  generator: null,
  mimeType: 'image/png',
  sizeBytes: 3,
  sha256: SHA,
  ...overrides,
});
const input = (overrides: Partial<ExportInput> = {}): ExportInput => ({
  draftId: 'draft-1',
  draftVersion: 1,
  status: 'approved',
  needsReview: false,
  claimWarningCount: 0,
  sections: {
    title: 'ชื่อ',
    hook: 'ฮุก',
    script: 'สคริปต์',
    storyboard: ['หนึ่ง', 'สอง'],
    caption: 'แคปชัน',
    hashtags: ['#หนึ่ง', '#สอง'],
    callToAction: 'สั่งเลย',
  },
  media: [],
  ...overrides,
});
const AT = new Date(Date.UTC(2026, 10, 4));

describe('media entry names', () => {
  it('are ASCII, numbered from 01, and labelled by role or scene', () => {
    expect(mediaEntryName(media({ role: 'cover' }), 0)).toBe('media/01-cover.png');
    expect(mediaEntryName(media({ scene: 'detail', mimeType: 'image/jpeg' }), 1)).toBe(
      'media/02-detail.jpg',
    );
    expect(mediaEntryName(media({ mimeType: 'video/mp4' }), 9)).toBe('media/10-media.mp4');
  });

  it('refuse a type that is not an allowed upload', () => {
    expect(() => mediaEntryName(media({ mimeType: 'image/svg+xml' }), 0)).toThrow();
  });
});

describe('the Thai checklist', () => {
  it('asks for approval only when the draft is not approved', () => {
    expect(formatChecklist(input({ status: 'approved' }))).not.toContain('ยังไม่ได้รับการอนุมัติ');
    expect(formatChecklist(input({ status: 'draft' }))).toContain('ยังไม่ได้รับการอนุมัติ');
    expect(formatChecklist(input({ status: 'in_review' }))).toContain('ยังไม่ได้รับการอนุมัติ');
  });

  it('shows the claim warning count only when there are warnings or a review flag', () => {
    expect(formatChecklist(input())).not.toContain('คำเตือนเรื่องข้อความโฆษณา');
    expect(formatChecklist(input({ claimWarningCount: 2 }))).toContain('2 รายการ');
    expect(formatChecklist(input({ needsReview: true }))).toContain('คำเตือนเรื่องข้อความโฆษณา');
  });

  it('names each AI tool once, and only when a file is AI-made', () => {
    expect(formatChecklist(input({ media: [media()] }))).not.toContain('AI');
    const text = formatChecklist(
      input({
        media: [
          media({ aiGenerated: true, generator: 'Meta AI' }),
          media({ assetId: 'b', aiGenerated: true, generator: 'Meta AI' }),
        ],
      }),
    );
    expect(text.match(/Meta AI/g)).toHaveLength(1);
  });

  it('always says that posting is manual', () => {
    expect(formatChecklist(input())).toContain('โพสต์เอง');
  });
});

describe('building a package', () => {
  it('is reproducible and keeps the media bytes in snapshot order', () => {
    const files = [
      { meta: media({ role: 'cover' }), data: Buffer.from([1, 2, 3]) },
      { meta: media({ assetId: 'b', scene: 'usage' }), data: Buffer.from([4, 5, 6]) },
    ];
    const snapshot = input({ media: files.map((file) => file.meta) });
    const a = buildPackage(snapshot, files, AT);
    const b = buildPackage(snapshot, files, AT);
    expect(a.entries.map((entry) => entry.name)).toEqual([
      'media/01-cover.png',
      'media/02-usage.png',
      'draft.txt',
      'caption.txt',
      'hashtags.txt',
      'publishing-checklist.md',
      'manifest.json',
    ]);
    expect(Buffer.from(a.entries[1]!.data).equals(Buffer.from([4, 5, 6]))).toBe(true);
    expect(JSON.stringify(a.manifest)).toBe(JSON.stringify(b.manifest));
  });

  it('refuses media that does not match the snapshot', () => {
    expect(() => buildPackage(input({ media: [media()] }), [], AT)).toThrow();
  });

  it('keeps the manifest free of file names the user chose and of URLs', () => {
    const files = [{ meta: media(), data: Buffer.from([1, 2, 3]) }];
    const manifest = JSON.stringify(buildPackage(input({ media: [media()] }), files, AT).manifest);
    expect(manifest).not.toMatch(/https?:/);
    expect(manifest).not.toContain('ไฟล์');
  });
});
