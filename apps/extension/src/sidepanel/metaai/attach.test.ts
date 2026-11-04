import type { ApiClient, DraftAsset } from '@creatorops/contracts';
import { describe, expect, it, vi } from 'vitest';

import { attachmentsWith, generatedFileName, uploadAndAttach } from './attach.js';
import { MetaAiError } from './runner.js';

const item = (
  assetId: string,
  scene: 'usage' | 'detail' | null,
  role: 'cover' | 'media' = 'media',
) => ({ assetId, scene, role, aiGenerated: false, generator: null });

describe('attachmentsWith', () => {
  it('keeps the others in order, replaces the scene file, and labels the new one', () => {
    const request = attachmentsWith(
      [item('cover', null, 'cover'), item('old', 'usage'), item('other', 'detail')],
      'usage',
      'new',
    );
    expect(request.assets.map((a) => a.assetId)).toEqual(['cover', 'other', 'new']);
    expect(request.assets[0]).toMatchObject({ role: 'cover' });
    expect(request.assets[2]).toEqual({
      assetId: 'new',
      role: 'media',
      scene: 'usage',
      aiGenerated: true,
      generator: 'Meta AI',
    });
  });

  it('refuses to go over ten files, but allows a replacement at ten', () => {
    const ten = Array.from({ length: 10 }, (_v, i) => item(`a${i}`, null));
    expect(() => attachmentsWith(ten, 'usage', 'new')).toThrow(MetaAiError);
    const full = [...ten.slice(0, 9), item('old', 'usage')];
    expect(attachmentsWith(full, 'usage', 'new').assets).toHaveLength(10);
  });
});

describe('generatedFileName', () => {
  it('is plain ASCII with the scene, the time and the type', () => {
    expect(generatedFileName('final_shot', 'image/png', new Date('2026-11-04T10:20:30Z'))).toBe(
      'meta-ai-final-shot-20261104T102030.png',
    );
    expect(generatedFileName('usage', 'image/jpeg', new Date('2026-11-04T10:20:30Z'))).toMatch(
      /\.jpg$/,
    );
  });
});

function fakeApi(overrides: { put?: Response } = {}) {
  const calls: string[] = [];
  const api = {
    resolveUrl: (path: string) => `http://api.test${path}`,
    assets: {
      createUploadIntent: vi.fn((_w: string, body: unknown) => {
        calls.push('intent');
        return Promise.resolve({
          intentId: 'i1',
          uploadUrl: '/upload/i1?sig=x',
          method: 'PUT',
          contentType: 'image/png',
          expiresAt: 'x',
          body,
        });
      }),
      completeUpload: vi.fn(() => {
        calls.push('complete');
        return Promise.resolve({ id: 'asset-new' });
      }),
    },
    drafts: {
      listAssets: vi.fn(() => {
        calls.push('list');
        return Promise.resolve({
          items: [{ ...item('keep', 'detail'), asset: {} } as unknown as DraftAsset],
        });
      }),
      setAssets: vi.fn(() => {
        calls.push('set');
        return Promise.resolve({ items: [] });
      }),
    },
  };
  const fetchImpl = vi.fn(() => {
    calls.push('put');
    return Promise.resolve(overrides.put ?? new Response(null, { status: 200 }));
  });
  return { api: api as unknown as ApiClient, raw: api, fetchImpl, calls };
}

const base = {
  workspaceId: 'w1',
  draftId: 'd1',
  productId: 'p1',
  scene: 'usage' as const,
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png' as const,
};

describe('uploadAndAttach', () => {
  it('uploads in order, sends no bearer token, and attaches with the AI label', async () => {
    const t = fakeApi();
    await uploadAndAttach({
      ...base,
      api: t.api,
      signal: new AbortController().signal,
      fetchImpl: t.fetchImpl as unknown as typeof fetch,
    });
    expect(t.calls).toEqual(['intent', 'put', 'complete', 'list', 'set']);
    const [url, init] = t.fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/upload/i1?sig=x');
    expect(init.method).toBe('PUT');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(t.raw.assets.createUploadIntent).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ mimeType: 'image/png', sizeBytes: 3, productId: 'p1' }),
    );
    expect(t.raw.drafts.setAssets).toHaveBeenCalledWith('w1', 'd1', {
      assets: [
        { assetId: 'keep', role: 'media', scene: 'detail', aiGenerated: false, generator: null },
        {
          assetId: 'asset-new',
          role: 'media',
          scene: 'usage',
          aiGenerated: true,
          generator: 'Meta AI',
        },
      ],
    });
  });

  it('stops with UPLOAD_FAILED when the server refuses the bytes, and attaches nothing', async () => {
    const t = fakeApi({ put: new Response('no', { status: 403 }) });
    await expect(
      uploadAndAttach({
        ...base,
        api: t.api,
        signal: new AbortController().signal,
        fetchImpl: t.fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(t.raw.drafts.setAssets).not.toHaveBeenCalled();
  });

  it('does not upload when already cancelled', async () => {
    const t = fakeApi();
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadAndAttach({
        ...base,
        api: t.api,
        signal: controller.signal,
        fetchImpl: t.fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(t.fetchImpl).not.toHaveBeenCalled();
  });
});
