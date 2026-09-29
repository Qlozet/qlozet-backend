import { BadRequestException } from '@nestjs/common';
import {
  assertValidImage,
  readImageSize,
  IMAGE_UPLOAD,
} from './image-upload';
import type { MulterFile } from '../types/upload';

/**
 * Upload guards. The dimension parser reads file headers by hand (no `sharp`),
 * so each container format is pinned against a hand-built header — a silent
 * misparse here would either wave through blurry photos or reject good ones.
 */
describe('image upload validation', () => {
  // ── Minimal, valid headers for each format ──

  const png = (width: number, height: number): Buffer => {
    const b = Buffer.alloc(32);
    b.writeUInt32BE(0x89504e47, 0); // signature
    b.writeUInt32BE(0x0d0a1a0a, 4);
    b.writeUInt32BE(13, 8); // IHDR length
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(width, 16);
    b.writeUInt32BE(height, 20);
    return b;
  };

  const jpeg = (width: number, height: number): Buffer => {
    const b = Buffer.alloc(32);
    b[0] = 0xff; b[1] = 0xd8; // SOI
    b[2] = 0xff; b[3] = 0xc0; // SOF0
    b.writeUInt16BE(17, 4); // segment length
    b[6] = 8; // sample precision
    b.writeUInt16BE(height, 7);
    b.writeUInt16BE(width, 9);
    return b;
  };

  /** JPEG with an APP0 segment before the frame header — the common real shape. */
  const jpegWithApp0 = (width: number, height: number): Buffer => {
    const b = Buffer.alloc(64);
    b[0] = 0xff; b[1] = 0xd8;
    b[2] = 0xff; b[3] = 0xe0; // APP0
    b.writeUInt16BE(16, 4); // length → next segment at 4 + 16 = 20
    b[20] = 0xff; b[21] = 0xc0;
    b.writeUInt16BE(17, 22);
    b[24] = 8;
    b.writeUInt16BE(height, 25);
    b.writeUInt16BE(width, 27);
    return b;
  };

  const webpVp8x = (width: number, height: number): Buffer => {
    const b = Buffer.alloc(32);
    b.write('RIFF', 0, 'ascii');
    b.write('WEBP', 8, 'ascii');
    b.write('VP8X', 12, 'ascii');
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
    return b;
  };

  const asFile = (buffer: Buffer, mimetype = 'image/jpeg'): MulterFile =>
    ({ buffer, mimetype, size: buffer.length } as MulterFile);

  describe('readImageSize', () => {
    it('reads PNG dimensions', () => {
      expect(readImageSize(png(1200, 1600))).toEqual({
        width: 1200,
        height: 1600,
        format: 'png',
      });
    });

    it('reads JPEG dimensions from the frame header', () => {
      expect(readImageSize(jpeg(1080, 1440))).toEqual({
        width: 1080,
        height: 1440,
        format: 'jpeg',
      });
    });

    it('walks past earlier JPEG segments to find the frame header', () => {
      expect(readImageSize(jpegWithApp0(2000, 3000))).toEqual({
        width: 2000,
        height: 3000,
        format: 'jpeg',
      });
    });

    it('reads WebP (VP8X) dimensions, which are stored minus one', () => {
      expect(readImageSize(webpVp8x(1500, 2000))).toEqual({
        width: 1500,
        height: 2000,
        format: 'webp',
      });
    });

    it('returns null for anything it cannot parse', () => {
      expect(readImageSize(Buffer.from('this is not an image at all, really'))).toBeNull();
      expect(readImageSize(Buffer.alloc(4))).toBeNull();
      expect(readImageSize(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('assertValidImage', () => {
    it('accepts a large-enough product photo', () => {
      expect(
        assertValidImage(asFile(jpeg(1200, 1600)), {
          minShortEdge: IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE,
        }),
      ).toMatchObject({ width: 1200, height: 1600 });
    });

    it('rejects a product photo below the resolution floor', () => {
      expect(() =>
        assertValidImage(asFile(jpeg(640, 480)), {
          label: 'product photo',
          minShortEdge: IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE,
        }),
      ).toThrow(
        new RegExp(
          `640×480px.*blurry.*at least ${IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE}px`,
          'is',
        ),
      );
    });

    it('measures the SHORT edge, so a tall narrow photo is still rejected', () => {
      // Tall enough to pass any "is it big?" test that looks at one dimension.
      expect(() =>
        assertValidImage(asFile(jpeg(IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE - 1, 4000)), {
          minShortEdge: IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE,
        }),
      ).toThrow(BadRequestException);
    });

    it('accepts a photo exactly at the floor', () => {
      const edge = IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE;
      expect(
        assertValidImage(asFile(jpeg(edge, edge)), { minShortEdge: edge }),
      ).toMatchObject({ width: edge, height: edge });
    });

    it('allows a small image when no floor is given (logos, AI references)', () => {
      expect(assertValidImage(asFile(png(256, 256)))).toMatchObject({
        width: 256,
        height: 256,
      });
    });

    it('rejects a file that only claims to be an image', () => {
      // A .txt renamed .jpg: the mimetype says image/jpeg, the bytes disagree.
      expect(() =>
        assertValidImage(asFile(Buffer.from('definitely not an image'), 'image/jpeg')),
      ).toThrow(/not a readable JPEG, PNG or WebP/i);
    });

    it('rejects an oversized file with the size in the message', () => {
      const huge = Buffer.concat([
        jpeg(2000, 3000),
        Buffer.alloc(IMAGE_UPLOAD.MAX_BYTES + 1),
      ]);
      expect(() => assertValidImage(asFile(huge))).toThrow(/limit is 10MB/i);
    });

    it('rejects an empty upload', () => {
      expect(() => assertValidImage(asFile(Buffer.alloc(0)))).toThrow(
        /empty or failed to upload/i,
      );
    });
  });
});
