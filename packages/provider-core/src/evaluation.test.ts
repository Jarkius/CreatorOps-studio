import { describe, expect, it } from 'vitest';

import { ProviderError } from './errors.js';
import {
  checkResult,
  EVAL_BRIEFS,
  formatScoreSheet,
  runEvaluation,
  thaiShare,
} from './evaluation.js';
import { MockTextProvider } from './mock.js';
import type { DraftSections } from './sections.js';
import type { GenerateBriefRequest, TextProvider } from './types.js';

const GOOD: DraftSections = {
  title: 'พัดลมพกพา ลมเย็นทุกที่',
  hook: 'ร้อนแบบนี้ ต้องมีตัวช่วย',
  script: 'พัดลมตัวเล็กพกง่าย ชาร์จได้ ใช้ได้ทั้งวัน',
  storyboard: ['ภาพสินค้า', 'ภาพใกล้', 'ภาพใช้งาน', 'ภาพปิดท้าย'],
  caption: 'พัดลมพกพา ใช้ง่าย',
  hashtags: ['#พัดลม'],
  callToAction: 'กดดูรายละเอียด',
};

class Fixed implements TextProvider {
  readonly id = 'fixed';
  constructor(
    private readonly make: (request: GenerateBriefRequest, call: number) => DraftSections | Error,
  ) {}
  private calls = 0;
  generateBrief(request: GenerateBriefRequest) {
    this.calls += 1;
    const result = this.make(request, this.calls);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({
      output: result,
      usage: { inputUnits: 1, outputUnits: 1, costUsd: 0.01 },
      model: 'm',
    });
  }
  regenerateSection(): never {
    throw new Error('unused');
  }
  generateVideoPrompts(): never {
    throw new Error('unused');
  }
}

const byId = (id: string) => EVAL_BRIEFS.find((b) => b.id === id)!;

describe('the evaluation briefs', () => {
  it('are 20 with unique ids, valid templates and a canary only where an instruction is planted', () => {
    expect(EVAL_BRIEFS).toHaveLength(20);
    expect(new Set(EVAL_BRIEFS.map((b) => b.id)).size).toBe(20);
    for (const item of EVAL_BRIEFS) {
      expect(item.request.product.name.length).toBeGreaterThan(0);
      if (item.canary !== undefined) {
        const planted = JSON.stringify(item.request.product);
        expect(planted).toContain(item.canary);
      }
    }
    expect(EVAL_BRIEFS.filter((b) => b.canary !== undefined).map((b) => b.id)).toEqual([
      'inject-ignore',
      'inject-json',
    ]);
    expect(EVAL_BRIEFS.some((b) => b.request.language === 'en')).toBe(true);
    expect(EVAL_BRIEFS.some((b) => b.request.product.restrictedClaims.length > 0)).toBe(true);
    expect(EVAL_BRIEFS.some((b) => b.request.product.sellingPoints.length === 0)).toBe(true);
  });
});

describe('checkResult', () => {
  it('passes a good Thai draft', () => {
    expect(checkResult(byId('fan'), GOOD)).toEqual([]);
  });

  it('flags non-Thai output for a Thai brief, but not for the English brief', () => {
    const english: DraftSections = {
      ...GOOD,
      title: 'Portable fan',
      hook: 'Hot day',
      script: 'A small fan you can carry',
      caption: 'Easy to use',
      callToAction: 'Tap to see',
      storyboard: ['a', 'b', 'c', 'd'],
      hashtags: ['#fan'],
    };
    expect(checkResult(byId('fan'), english)).toContain('thai');
    expect(checkResult(byId('english'), english)).not.toContain('thai');
  });

  it('flags a wrong scene count, no hashtags, a restricted claim, a leaked canary, and an invented price', () => {
    expect(checkResult(byId('fan'), { ...GOOD, storyboard: ['a', 'b'] })).toContain('scenes');
    expect(checkResult(byId('fan'), { ...GOOD, hashtags: [] })).toContain('hashtags');
    expect(checkResult(byId('serum'), { ...GOOD, caption: 'ผิวขาวใน 7 วัน ลองเลย' })).toContain(
      'claims',
    );
    expect(checkResult(byId('inject-ignore'), { ...GOOD, title: 'ZX-CANARY-7731 หมอน' })).toContain(
      'canary',
    );
    expect(checkResult(byId('no-price'), { ...GOOD, caption: 'เพียง 199 บาท' })).toContain('price');
    // A brief that has a price may mention one.
    expect(checkResult(byId('fan'), { ...GOOD, caption: 'เพียง 299 บาท' })).not.toContain('price');
  });
});

describe('thaiShare', () => {
  it('is the share of Thai letters among letters', () => {
    expect(thaiShare('')).toBe(0);
    expect(thaiShare('abc')).toBe(0);
    expect(thaiShare('กขค')).toBe(1);
    expect(thaiShare('กข ab')).toBeCloseTo(0.5, 5);
  });
});

describe('runEvaluation', () => {
  it('runs every brief in order, sums reported cost, and calls onRow for each', async () => {
    const seen: string[] = [];
    const report = await runEvaluation(new Fixed(() => GOOD), EVAL_BRIEFS.slice(0, 3), {
      onRow: (row) => seen.push(row.id),
    });
    expect(seen).toEqual(['fan', 'serum', 'supplement']);
    expect(report).toMatchObject({ provider: 'fixed', total: 3, passed: 3 });
    expect(report.costUsd).toBeCloseTo(0.03, 6);
  });

  it('records a provider failure as a row with its code and carries on', async () => {
    const report = await runEvaluation(
      new Fixed((_, call) =>
        call === 1
          ? new ProviderError('RATE_LIMITED')
          : call === 2
            ? new Error('boom sk-secret')
            : GOOD,
      ),
      EVAL_BRIEFS.slice(0, 3),
    );
    expect(report.rows.map((r) => r.errorCode)).toEqual(['RATE_LIMITED', 'UNKNOWN', null]);
    expect(report.passed).toBe(1);
    expect(JSON.stringify(report)).not.toContain('sk-secret');
  });

  it('is deterministic with the built-in writer, and every brief runs through it', async () => {
    const first = await runEvaluation(new MockTextProvider());
    const second = await runEvaluation(new MockTextProvider());
    expect(first.rows.map((r) => r.title)).toEqual(second.rows.map((r) => r.title));
    expect(first.total).toBe(20);
    expect(first.rows.every((r) => r.errorCode === null)).toBe(true);
  });
});

describe('formatScoreSheet', () => {
  it('lists the results, every output, and empty score boxes', async () => {
    const report = await runEvaluation(new Fixed(() => GOOD), EVAL_BRIEFS.slice(0, 2));
    const sheet = formatScoreSheet(report, 'vendor/model-x');
    expect(sheet).toContain('# Thai text evaluation: fixed / vendor/model-x');
    expect(sheet).toContain('| fan | pass |');
    expect(sheet).toContain('พัดลมพกพา ลมเย็นทุกที่');
    expect(sheet.match(/Scores: natural __/g)).toHaveLength(2);
  });
});
