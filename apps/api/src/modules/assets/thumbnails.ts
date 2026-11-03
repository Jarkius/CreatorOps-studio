import sharp from 'sharp';

import { AppError } from '../../platform/errors.js';

// Do not keep decoded images in memory between requests. `sharp.concurrency` only limits threads
// per image, so the number of images decoded at once is limited separately (below): each one can
// need hundreds of megabytes at the pixel limit.
sharp.cache(false);
sharp.concurrency(1);

/** Runs at most `max` tasks at once; the rest wait their turn. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  const next = (): void => {
    const start = waiting.shift();
    if (start) start();
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      next();
    }
  };
}

export const MAX_CONCURRENT_DECODES = 2;
const limitDecodes = createLimiter(MAX_CONCURRENT_DECODES);

/** Refuse images that decode to more than this many pixels (decompression bombs). */
export const MAX_INPUT_PIXELS = 40_000_000;
export const THUMBNAIL_SIZE = 512;

export interface ImageInfo {
  readonly width: number;
  readonly height: number;
  readonly thumbnail: Buffer;
}

/**
 * Reads an already type-checked image and makes its thumbnail.
 * - Pixel limit and `failOn: 'error'` reject bombs and corrupt files.
 * - Only the first frame of animated GIF/WebP is used.
 * - EXIF orientation is applied; all metadata (EXIF, GPS, ICC) is dropped from the output.
 * - Width and height are those the viewer will see, after orientation.
 */
export function readImage(bytes: Buffer): Promise<ImageInfo> {
  return limitDecodes(() => decodeImage(bytes));
}

async function decodeImage(bytes: Buffer): Promise<ImageInfo> {
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      sequentialRead: true,
      animated: false,
    });
    const metadata = await image.metadata();
    const rawWidth = metadata.width;
    const rawHeight = metadata.height;
    if (rawWidth === undefined || rawHeight === undefined) throw new Error('no dimensions');
    const swapped = (metadata.orientation ?? 1) >= 5;

    const thumbnail = await image
      .rotate()
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    return {
      width: swapped ? rawHeight : rawWidth,
      height: swapped ? rawWidth : rawHeight,
      thumbnail,
    };
  } catch {
    // The message never includes decoder output, which can echo file contents.
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The image could not be read.');
  }
}
