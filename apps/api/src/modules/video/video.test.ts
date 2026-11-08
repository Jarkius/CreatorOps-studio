import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assembleArgs, probe, runTool, VideoToolMissing, type VideoTools } from './ffmpeg.js';
import { buildAss, buildSrt, cleanText, cuesFor, wrapLines } from './subtitles.js';

describe('subtitles', () => {
  it('neutralises ASS commands and folds line breaks', () => {
    expect(cleanText('สวัสดี {\\b1}ครับ\\N\nบรรทัด')).toBe('สวัสดี /b1ครับ/N บรรทัด');
  });

  it('wraps Thai at word boundaries, never inside a word, counting tone marks as nothing', () => {
    const lines = wrapLines('แนะนำโคมไฟตั้งโต๊ะถนอมสายตาสำหรับคนทำงานกลางคืน', 18);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('แนะนำโคมไฟตั้งโต๊ะถนอมสายตาสำหรับคนทำงานกลางคืน');
    const words = new Set([
      'แนะนำ',
      'โคม',
      'ไฟ',
      'ตั้ง',
      'โต๊ะ',
      'ถนอม',
      'สายตา',
      'สำหรับ',
      'คน',
      'ทำงาน',
      'กลาง',
      'คืน',
    ]);
    for (const line of lines) {
      const segments = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(line)];
      for (const s of segments) expect(words.has(s.segment), s.segment).toBe(true);
    }
  });

  it('keeps at most three lines and marks the cut', () => {
    const lines = wrapLines('คำ '.repeat(80), 10);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith('…')).toBe(true);
  });

  it('times one cue per clip and skips clips without a line', () => {
    expect(
      cuesFor([
        { durationMs: 8000, voiceover: 'หนึ่ง' },
        { durationMs: 5000, voiceover: null },
        { durationMs: 8000, voiceover: 'สาม' },
      ]),
    ).toEqual([
      { startMs: 0, endMs: 8000, text: 'หนึ่ง' },
      { startMs: 13000, endMs: 21000, text: 'สาม' },
    ]);
  });

  it('writes ASS and SRT with the right times and no override from the text', () => {
    const cues = [{ startMs: 1500, endMs: 9250, text: 'ลอง {\\fs200}ดู' }];
    const ass = buildAss(cues, 'Noto Sans Thai');
    expect(ass).toContain('Style: Default,Noto Sans Thai,64,');
    expect(ass).toContain('Dialogue: 0,0:00:01.50,0:00:09.25,Default,,0,0,0,,ลอง /fs200ดู');
    expect(ass).not.toContain('{');
    expect(buildSrt(cues)).toBe('1\n00:00:01,500 --> 00:00:09,250\nลอง /fs200ดู\n');
  });
});

const HAS_FFMPEG = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!HAS_FFMPEG && process.env.SKIP_FFMPEG_TESTS !== '1') {
  throw new Error(
    'ffmpeg is not installed. Install it (see docs/USER_GUIDE.md) or set SKIP_FFMPEG_TESTS=1 to skip the video tests on purpose.',
  );
}

describe.skipIf(!HAS_FFMPEG)('ffmpeg assembly', () => {
  const tools: VideoTools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', subtitleFont: 'Loma' };
  let dir = '';
  const signal = () => new AbortController().signal;

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'video-test-'));
    // A silent landscape clip and a portrait clip with sound, of different lengths.
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=640x360:rate=25:duration=2',
      '-pix_fmt',
      'yuv420p',
      path.join(dir, 'a.mp4'),
    ]);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=720x1280:rate=30:duration=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=3',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      path.join(dir, 'b.mp4'),
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('joins clips of different sizes, one silent, into one 1080x1920 MP4 with Thai subtitles', async () => {
    const a = await probe(tools, 'a.mp4', { cwd: dir, signal: signal() });
    const b = await probe(tools, 'b.mp4', { cwd: dir, signal: signal() });
    expect(a.hasAudio).toBe(false);
    expect(b.hasAudio).toBe(true);
    const cues = cuesFor([
      { durationMs: a.durationMs, voiceover: 'แนะนำโคมไฟตั้งโต๊ะถนอมสายตา ปรับแสงได้สามระดับ' },
      { durationMs: b.durationMs, voiceover: 'ใช้งานง่ายในชีวิตประจำวัน' },
    ]);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(dir, 'subs.ass'), buildAss(cues, tools.subtitleFont));
    await runTool(
      tools.ffmpeg,
      assembleArgs(
        [
          { file: 'a.mp4', ...a },
          { file: 'b.mp4', ...b },
        ],
        { subtitleFile: 'subs.ass', output: 'out.mp4' },
      ),
      { cwd: dir, signal: signal() },
    );
    const out = await probe(tools, 'out.mp4', { cwd: dir, signal: signal() });
    expect(out.hasVideo && out.hasAudio).toBe(true);
    expect(Math.abs(out.durationMs - (a.durationMs + b.durationMs))).toBeLessThan(250);
    const size = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      path.join(dir, 'out.mp4'),
    ])
      .toString()
      .trim();
    expect(size).toBe('1080,1920');
    expect(statSync(path.join(dir, 'out.mp4')).size).toBeGreaterThan(1000);
    if (process.env.VIDEO_FRAME_OUT !== undefined) {
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-ss',
        '1',
        '-i',
        path.join(dir, 'out.mp4'),
        '-frames:v',
        '1',
        process.env.VIDEO_FRAME_OUT,
      ]);
    }
  });

  it('kills ffmpeg when the job is aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const run = runTool(
      tools.ffmpeg,
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=1080x1920:rate=30:duration=600',
        '-f',
        'null',
        '-',
      ],
      { cwd: dir, signal: controller.signal },
    );
    setTimeout(() => controller.abort(new Error('cancel')), 300);
    await expect(run).rejects.toThrow('cancel');
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('names a missing tool as missing', async () => {
    await expect(
      runTool('/no/such/ffmpeg', ['-version'], { cwd: dir, signal: signal() }),
    ).rejects.toBeInstanceOf(VideoToolMissing);
  });
});
