import type { DraftSections } from '@creatorops/contracts';

import type { ExportInput, ExportMediaInput } from './input.js';
import type { ZipEntry } from './zip.js';

/** File extension by MIME type; the upload validator allows only these (D-043). */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
};

export interface PackageMedia {
  readonly meta: ExportMediaInput;
  readonly data: Uint8Array;
}

export interface BuiltPackage {
  readonly entries: ZipEntry[];
  readonly manifest: Record<string, unknown>;
}

const utf8 = (text: string): Uint8Array => Buffer.from(text, 'utf8');

/** Server-generated ASCII name of one media file: `media/01-cover.jpg`, `media/02-detail.png`. */
export function mediaEntryName(meta: ExportMediaInput, index: number): string {
  const extension = EXTENSIONS[meta.mimeType];
  if (extension === undefined) throw new Error('Unsupported media type');
  const label = meta.role === 'cover' ? 'cover' : (meta.scene ?? 'media');
  return `media/${String(index + 1).padStart(2, '0')}-${label}.${extension}`;
}

/** The whole draft as plain text: a heading line, then the text; sections split by a blank line. */
export function formatDraftText(sections: DraftSections): string {
  const part = (heading: string, body: string): string => `${heading}\n${body}`;
  return (
    [
      part('Title', sections.title),
      part('Hook', sections.hook),
      part('Script', sections.script),
      part(
        'Storyboard',
        sections.storyboard.map((scene, i) => `${String(i + 1)}. ${scene}`).join('\n'),
      ),
      part('Caption', sections.caption),
      part('Hashtags', sections.hashtags.join(' ')),
      part('Call to action', sections.callToAction),
    ].join('\n\n') + '\n'
  );
}

/** The Thai checklist the owner reads before posting by hand (publishing is manual, D-017). */
export function formatChecklist(input: ExportInput): string {
  const lines = ['# รายการตรวจก่อนโพสต์', ''];
  if (input.status !== 'approved') {
    lines.push('- [ ] ฉบับร่างนี้ยังไม่ได้รับการอนุมัติ ตรวจสอบเนื้อหาให้เรียบร้อยก่อนโพสต์');
  }
  if (input.needsReview || input.claimWarningCount > 0) {
    lines.push(
      `- [ ] มีคำเตือนเรื่องข้อความโฆษณา ${String(input.claimWarningCount)} รายการ ตรวจสอบคำกล่าวอ้างก่อนโพสต์`,
    );
  }
  lines.push('- [ ] อ่านแคปชันและแฮชแท็กอีกครั้ง (caption.txt, hashtags.txt)');
  lines.push('- [ ] ตรวจว่ารูปและวิดีโอตรงกับสินค้าจริงและคุณมีสิทธิ์ใช้งาน');
  if (input.media.some((item) => item.aiGenerated)) {
    const names = [
      ...new Set(
        input.media.filter((item) => item.aiGenerated).map((item) => item.generator ?? 'AI'),
      ),
    ];
    lines.push(
      `- [ ] ไฟล์ที่สร้างด้วย AI (${names.join(', ')}) ติดป้ายหรือแจ้งตามกฎของแพลตฟอร์มที่จะโพสต์`,
    );
  }
  lines.push('- [ ] อัปโหลดและโพสต์เองบนแพลตฟอร์ม (CreatorOps ไม่ได้โพสต์ให้)');
  return lines.join('\n') + '\n';
}

/**
 * Builds the files of one package from the snapshot and the media bytes (S5.7). Pure: the same
 * input gives the same entries, byte for byte. Names are ASCII; Thai lives only inside the text
 * files (D-067 item 7).
 */
export function buildPackage(
  input: ExportInput,
  media: readonly PackageMedia[],
  createdAt: Date,
): BuiltPackage {
  if (media.length !== input.media.length) throw new Error('Media does not match the snapshot');
  const entries: ZipEntry[] = [];
  const files: Record<string, unknown>[] = [];

  media.forEach((item, index) => {
    const name = mediaEntryName(item.meta, index);
    entries.push({ name, data: item.data });
    files.push({
      path: name,
      role: item.meta.role,
      scene: item.meta.scene,
      mimeType: item.meta.mimeType,
      sizeBytes: item.meta.sizeBytes,
      sha256: item.meta.sha256,
      aiGenerated: item.meta.aiGenerated,
      generator: item.meta.generator,
    });
  });

  const text: [string, string][] = [
    ['draft.txt', formatDraftText(input.sections)],
    ['caption.txt', input.sections.caption + '\n'],
    ['hashtags.txt', input.sections.hashtags.join(' ') + '\n'],
    ['publishing-checklist.md', formatChecklist(input)],
  ];
  for (const [name, body] of text) entries.push({ name, data: utf8(body) });

  const manifest: Record<string, unknown> = {
    version: 1,
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    draftStatus: input.status,
    createdAt: createdAt.toISOString(),
    media: files,
    text: text.map(([name]) => name),
  };
  entries.push({ name: 'manifest.json', data: utf8(JSON.stringify(manifest, null, 2) + '\n') });
  return { entries, manifest };
}
