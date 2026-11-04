import { describe, expect, it } from 'vitest';

import {
  CreateExportRequestSchema,
  EXPORT_LIMITS,
  ExportListQuerySchema,
  SetDraftAssetsRequestSchema,
} from './export.js';

const id = (n: number) => `asset-${n}`;

describe('SetDraftAssetsRequestSchema', () => {
  it('accepts an ordered list, defaulting the role to media', () => {
    const parsed = SetDraftAssetsRequestSchema.parse({
      assets: [{ assetId: id(1), role: 'cover' }, { assetId: id(2) }],
    });
    expect(parsed.assets.map((item) => item.role)).toEqual(['cover', 'media']);
  });

  it('accepts a scene, an AI label and a generator name, and refuses an unknown scene or a long name', () => {
    const parsed = SetDraftAssetsRequestSchema.parse({
      assets: [{ assetId: id(1), scene: 'final_shot', aiGenerated: true, generator: ' Meta AI ' }],
    });
    expect(parsed.assets[0]).toMatchObject({
      scene: 'final_shot',
      aiGenerated: true,
      generator: 'Meta AI',
    });
    expect(
      SetDraftAssetsRequestSchema.parse({ assets: [{ assetId: id(1) }] }).assets[0],
    ).toMatchObject({
      aiGenerated: false,
    });
    expect(
      SetDraftAssetsRequestSchema.safeParse({ assets: [{ assetId: id(1), scene: 'intro' }] })
        .success,
    ).toBe(false);
    expect(
      SetDraftAssetsRequestSchema.safeParse({
        assets: [{ assetId: id(1), generator: 'x'.repeat(61) }],
      }).success,
    ).toBe(false);
  });

  it('accepts an empty list (detach everything)', () => {
    expect(SetDraftAssetsRequestSchema.parse({ assets: [] }).assets).toEqual([]);
  });

  it('refuses two covers, a repeated asset (any letter case) and more than the limit', () => {
    expect(
      SetDraftAssetsRequestSchema.safeParse({
        assets: [
          { assetId: id(1), role: 'cover' },
          { assetId: id(2), role: 'cover' },
        ],
      }).success,
    ).toBe(false);
    expect(
      SetDraftAssetsRequestSchema.safeParse({
        assets: [{ assetId: 'ABC-1234' }, { assetId: 'abc-1234' }],
      }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: EXPORT_LIMITS.maxAssetsPerDraft + 1 }, (_v, i) => ({
      assetId: id(i),
    }));
    expect(SetDraftAssetsRequestSchema.safeParse({ assets: tooMany }).success).toBe(false);
  });

  it('refuses unknown fields, an unknown role and an empty id', () => {
    expect(
      SetDraftAssetsRequestSchema.safeParse({ assets: [{ assetId: id(1), extra: 1 }] }).success,
    ).toBe(false);
    expect(
      SetDraftAssetsRequestSchema.safeParse({ assets: [{ assetId: id(1), role: 'poster' }] })
        .success,
    ).toBe(false);
    expect(SetDraftAssetsRequestSchema.safeParse({ assets: [{ assetId: '' }] }).success).toBe(
      false,
    );
    expect(SetDraftAssetsRequestSchema.safeParse({ assets: [], x: 1 }).success).toBe(false);
  });
});

describe('CreateExportRequestSchema and ExportListQuerySchema', () => {
  it('needs a draft id and a positive integer version, and nothing else', () => {
    expect(CreateExportRequestSchema.safeParse({ draftId: 'd1', draftVersion: 3 }).success).toBe(
      true,
    );
    for (const bad of [
      { draftId: 'd1' },
      { draftVersion: 1 },
      { draftId: 'd1', draftVersion: 0 },
      { draftId: 'd1', draftVersion: 1.5 },
      { draftId: 'd1', draftVersion: 1, extra: true },
    ]) {
      expect(CreateExportRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('defaults the page size and refuses a limit outside 1 to 100', () => {
    expect(ExportListQuerySchema.parse({}).limit).toBe(25);
    expect(ExportListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(ExportListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
