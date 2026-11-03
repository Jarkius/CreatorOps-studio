import sharp from 'sharp';

import { AppError } from '../../platform/errors.js';

// Do not keep decoded images in memory between requests, and process one image at a time.
sharp.cache(false);
sharp.concurrency(1);

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
export async function readImage(bytes: Buffer): Promise<ImageInfo> {
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
