import { describe, expect, it } from 'vitest';

import { detectMediaType } from './detect.js';

const pad = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
const ascii = (text: string) => Buffer.from(text, 'latin1');

describe('detectMediaType', () => {
  it('recognises the allowed types by their first bytes', () => {
    expect(detectMediaType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectMediaType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(detectMediaType(Buffer.concat([ascii('GIF89a'), Buffer.alloc(10)]))).toBe('image/gif');
    expect(detectMediaType(Buffer.concat([ascii('GIF87a'), Buffer.alloc(10)]))).toBe('image/gif');
    expect(
      detectMediaType(
        Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WEBP'), Buffer.alloc(4)]),
      ),
    ).toBe('image/webp');
    expect(
      detectMediaType(Buffer.concat([Buffer.alloc(4), ascii('ftypisom'), Buffer.alloc(4)])),
    ).toBe('video/mp4');
    expect(
      detectMediaType(Buffer.concat([Buffer.alloc(4), ascii('ftypmp42'), Buffer.alloc(4)])),
    ).toBe('video/mp4');
  });

  it('rejects SVG, HTML, scripts, archives and executables, whatever they claim to be', () => {
    for (const text of [
      '<svg xmlns="http://www.w3.org/2000/svg"',
      '<?xml version="1.0"?>',
      '<!DOCTYPE html><html>',
      '<script>alert(1)</script>',
      '#!/bin/sh\necho hi\n',
    ]) {
      expect(detectMediaType(Buffer.concat([ascii(text), Buffer.alloc(16)])), text).toBeNull();
    }
    expect(detectMediaType(pad([0x50, 0x4b, 0x03, 0x04]))).toBeNull(); // zip
    expect(detectMediaType(pad([0x4d, 0x5a, 0x90, 0x00]))).toBeNull(); // Windows executable
    expect(detectMediaType(pad([0x7f, 0x45, 0x4c, 0x46]))).toBeNull(); // ELF
    expect(detectMediaType(pad([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // PDF
  });

  it('rejects look-alikes and truncated headers', () => {
    expect(
      detectMediaType(
        Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVE'), Buffer.alloc(4)]),
      ),
    ).toBeNull(); // RIFF but not WebP
    expect(
      detectMediaType(Buffer.concat([Buffer.alloc(4), ascii('ftypheic'), Buffer.alloc(4)])),
    ).toBeNull(); // unknown ftyp brand
    expect(detectMediaType(Buffer.from([0xff, 0xd8]))).toBeNull(); // JPEG cut short
    expect(detectMediaType(Buffer.alloc(0))).toBeNull();
    expect(detectMediaType(Buffer.alloc(16))).toBeNull();
  });

  it('looks only at the beginning of the data', () => {
    expect(
      detectMediaType(
        Buffer.concat([ascii('<html>'), Buffer.alloc(8), Buffer.from([0xff, 0xd8, 0xff])]),
      ),
    ).toBeNull();
  });
});
