import { BadRequestException } from '@nestjs/common';
import type { MulterFile } from '../types/upload';

/**
 * Server-side guards for image uploads.
 *
 * Before this, `FileInterceptor('file')` was unconfigured: no size limit, no
 * type check, no dimension check. The `accept=` attribute on the vendor's file
 * input is advisory only — anything could be POSTed straight through to
 * Cloudinary and served to shoppers as-is.
 *
 * Dimensions are read from the file header rather than with `sharp` or
 * `image-size`, to avoid a native dependency in the Fly build for what is
 * ~60 lines of well-defined header parsing.
 */

export const IMAGE_UPLOAD = {
  /** Allowed formats. WebP included — vendors export it and the shop renders it. */
  ALLOWED_MIME: ['image/jpeg', 'image/png', 'image/webp'] as const,

  /**
   * Friendly ceiling. Rejected with an explanatory message, so a vendor knows
   * to re-export rather than seeing a generic failure.
   */
  MAX_BYTES: 10 * 1024 * 1024, // 10 MB

  /**
   * Hard ceiling handed to multer. Deliberately ABOVE MAX_BYTES: multer aborts
   * the stream (protecting memory — every upload is buffered in RAM), but its
   * error is opaque, so normal oversize files hit our friendlier check first
   * and only genuinely huge ones are cut off here.
   */
  MULTER_MAX_BYTES: 15 * 1024 * 1024, // 15 MB

  /**
   * Minimum short edge for PRODUCT photos. The shop renders the PDP hero in a
   * fixed 3:4 frame on high-DPI screens, so anything below this is visibly
   * soft. Not applied to logos or AI reference shots, which are legitimately
   * small.
   *
   * Set deliberately low to start: this rejects uploads that previously
   * succeeded, so the first pass only catches genuinely tiny images (thumbnails,
   * screenshots, web-scraped stock). 1000+ is the quality target — raise this
   * once vendor uploads have been observed against it.
   */
  MIN_PRODUCT_SHORT_EDGE: 800,
} as const;

export interface ImageSize {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
}

/**
 * Read width/height straight from the file header.
 * Returns null when the bytes are not a JPEG, PNG or WebP we can parse —
 * callers treat that as "not a real image".
 */
export function readImageSize(buffer: Buffer): ImageSize | null {
  if (!buffer || buffer.length < 24) return null;

  // ── PNG: 8-byte signature, then an IHDR chunk with width/height at 16/20 ──
  if (
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.readUInt32BE(4) === 0x0d0a1a0a
  ) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
      format: 'png',
    };
  }

  // ── JPEG: walk the segment chain to the frame header (SOF) ──
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++; // resync past padding
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0-SOF15 carry the dimensions. SOF4 (DHT), SOF8 (JPG) and SOF12
      // (DAC) share the range but are not frame headers.
      const isFrameHeader =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrameHeader) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
          format: 'jpeg',
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null; // malformed
      offset += 2 + segmentLength;
    }
    return null;
  }

  // ── WebP: RIFF container, three possible frame encodings ──
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buffer.toString('ascii', 12, 16);

    if (chunk === 'VP8 ' && buffer.length >= 30) {
      // Lossy: 14-bit dimensions in the VP8 frame header.
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
        format: 'webp',
      };
    }
    if (chunk === 'VP8L' && buffer.length >= 25) {
      // Lossless: 14 bits each, packed across four bytes from offset 21.
      const bits = buffer.readUInt32LE(21);
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        format: 'webp',
      };
    }
    if (chunk === 'VP8X' && buffer.length >= 30) {
      // Extended: 24-bit canvas size, stored minus one.
      return {
        width: buffer.readUIntLE(24, 3) + 1,
        height: buffer.readUIntLE(27, 3) + 1,
        format: 'webp',
      };
    }
    return null;
  }

  return null;
}

/** multer options: bound memory and reject obviously wrong content types. */
export const imageUploadOptions = {
  limits: { fileSize: IMAGE_UPLOAD.MULTER_MAX_BYTES },
  fileFilter: (
    _req: unknown,
    file: { mimetype: string },
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!IMAGE_UPLOAD.ALLOWED_MIME.includes(file.mimetype as never)) {
      return cb(
        new BadRequestException(
          `Unsupported image type "${file.mimetype}". Use JPEG, PNG or WebP.`,
        ),
        false,
      );
    }
    cb(null, true);
  },
};

/**
 * Supporting documents (the CAC certificate) are not images: a certificate is
 * usually a PDF, and a scan of one has no meaningful minimum resolution.
 *
 * The CAC file picker has always offered application/pdf while uploading
 * through the profile-image route, whose filter only admits JPEG, PNG and
 * WebP - so choosing the actual certificate failed with "Failed to upload
 * image" and the vendor had no way to know why.
 */
export const DOCUMENT_UPLOAD = {
  ALLOWED_MIME: [
    'application/pdf',
    'image/jpeg',
    'image/png',
  ] as const,
  /** Friendly ceiling. A scanned certificate is a few MB at most. */
  MAX_BYTES: 10 * 1024 * 1024,
  /** Multer's hard stop, above the friendly one so the message is ours. */
  MULTER_MAX_BYTES: 15 * 1024 * 1024,
} as const;

export const documentUploadOptions = {
  limits: { fileSize: DOCUMENT_UPLOAD.MULTER_MAX_BYTES },
  fileFilter: (
    _req: unknown,
    file: { mimetype: string },
    cb: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!DOCUMENT_UPLOAD.ALLOWED_MIME.includes(file.mimetype as never)) {
      return cb(
        new BadRequestException(
          `Unsupported document type "${file.mimetype}". Upload a PDF, JPEG or PNG.`,
        ),
        false,
      );
    }
    cb(null, true);
  },
};

/**
 * Documents are checked by type and size only. A PDF has no pixel dimensions,
 * and rejecting a legible scan for being small would block the one thing the
 * upload exists for.
 */
export function assertValidDocument(
  file: MulterFile,
  options: { maxBytes?: number; label?: string } = {},
): void {
  const label = options.label ?? 'document';
  const maxBytes = options.maxBytes ?? DOCUMENT_UPLOAD.MAX_BYTES;

  if (!DOCUMENT_UPLOAD.ALLOWED_MIME.includes(file.mimetype as never)) {
    throw new BadRequestException(
      `That ${label} is a "${file.mimetype}" file. Upload a PDF, JPEG or PNG.`,
    );
  }

  if (!file?.buffer?.length) {
    throw new BadRequestException(`The ${label} is empty or failed to upload.`);
  }

  // buffer.length, not file.size: size is client-declared and optional, the
  // buffer is what was actually received. Same reasoning as assertValidImage.
  if (file.buffer.length > maxBytes) {
    throw new BadRequestException(
      `That ${label} is ${prettyMb(file.buffer.length)}. ` +
        `Keep it under ${prettyMb(maxBytes)}.`,
    );
  }
}

const prettyMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;

/**
 * Validate an uploaded image. Throws a BadRequestException the vendor console
 * surfaces verbatim, so the message has to explain the fix.
 *
 * @param minShortEdge omit for logos and AI reference images, which are
 *        legitimately small; pass MIN_PRODUCT_SHORT_EDGE for product photos.
 */
export function assertValidImage(
  file: MulterFile,
  opts: { minShortEdge?: number; maxBytes?: number; label?: string } = {},
): ImageSize {
  const label = opts.label ?? 'image';
  // Admin-tunable via PlatformSettings; the constant is the fallback when the
  // settings document is unreachable, so a settings outage can't block uploads.
  const maxBytes = opts.maxBytes ?? IMAGE_UPLOAD.MAX_BYTES;

  if (!file?.buffer?.length) {
    throw new BadRequestException(`The ${label} is empty or failed to upload.`);
  }

  if (file.buffer.length > maxBytes) {
    throw new BadRequestException(
      `This ${label} is ${prettyMb(file.buffer.length)}. The limit is ` +
        `${prettyMb(maxBytes)} — export it at a lower quality ` +
        `and try again.`,
    );
  }

  // The declared mimetype comes from the client and can be wrong or spoofed,
  // so the real check is the file's own header.
  const size = readImageSize(file.buffer);
  if (!size) {
    throw new BadRequestException(
      `That file is not a readable JPEG, PNG or WebP image. If you renamed a ` +
        `file to change its extension, re-export it properly instead.`,
    );
  }

  if (!size.width || !size.height) {
    throw new BadRequestException(`Could not read the ${label}'s dimensions.`);
  }

  const minShortEdge = opts.minShortEdge;
  if (minShortEdge) {
    const shortEdge = Math.min(size.width, size.height);
    if (shortEdge < minShortEdge) {
      throw new BadRequestException(
        `This ${label} is ${size.width}×${size.height}px, which will look ` +
          `blurry on a product page. Upload one at least ${minShortEdge}px on ` +
          `its shortest side.`,
      );
    }
  }

  return size;
}
