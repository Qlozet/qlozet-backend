import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { MulterFile } from 'src/common/types/upload';

/**
 * Pull the text Cloudinary's OCR add-on found, if it ran at all.
 *
 * Deliberately forgiving. The add-on may be off, the response shape may
 * change, or OCR may simply find nothing - and none of those are a reason to
 * fail an upload. Returning undefined means "we did not learn anything", which
 * callers treat as permission to continue rather than as a violation.
 */
function readOcrText(result: Record<string, any>): string | undefined {
  try {
    const annotation =
      result?.info?.ocr?.adv_ocr?.data?.[0]?.textAnnotations?.[0]?.description;
    const text = typeof annotation === 'string' ? annotation.trim() : '';
    return text || undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class CloudinaryService {
  async uploadBase64(base64: string, folderName: string) {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.from(base64, 'base64');

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folderName,
          resource_type: 'image',
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload result is undefined'));
          resolve({
            fileUrl: result.secure_url,
            filePublicId: result.public_id,
            width: result.width,
            height: result.height,
          });
        },
      );

      uploadStream.end(buffer);
    });
  }

  getCloudinaryPublicId(fileUrl: string): string {
    const parts = fileUrl.split('/upload/');
    if (parts.length < 2) throw new Error('Invalid Cloudinary URL');

    let path = parts[1]; // v123456/folder/file.png
    path = path.replace(/^v\d+\//, ''); // remove version
    path = path.replace(/\.[^/.]+$/, ''); // remove extension

    return path;
  }

  /**
   * Cloudinary reports the stored dimensions on every upload, and the product
   * image schema has had width/height fields all along - they were simply
   * never populated, because this resolved only the url and the id. Carrying
   * them through is what makes any image-quality rule possible: a listing
   * check cannot ask how big a photo is after the fact without re-fetching it
   * from Cloudinary one image at a time.
   */
  async uploadFile(
    file: MulterFile,
    folderName: string,
    options: { scanText?: boolean } = {},
  ): Promise<{
    fileUrl: string;
    filePublicId: string;
    width?: number;
    height?: number;
    detectedText?: string;
  }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folderName,
          resource_type: 'auto',
          // Cloudinary's OCR add-on, billed per use and off unless an admin
          // turns it on. Asking for it without a subscription makes Cloudinary
          // reject the upload, which is why the caller decides rather than
          // this being always-on.
          ...(options.scanText ? { ocr: 'adv_ocr' } : {}),
        },
        (error, result) => {
          if (error) {
            return reject(error);
          }
          if (!result) {
            return reject(new Error('Upload result is undefined'));
          }
          resolve({
            fileUrl: result.secure_url,
            filePublicId: result.public_id,
            width: result.width,
            height: result.height,
            detectedText: readOcrText(result),
          });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async uploadMeshPrediction(
    buffer: Buffer,
    folderName: string,
    originalName?: string,
  ): Promise<{ imageUrl: string; imagePublicId: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: folderName, resource_type: 'auto', public_id: originalName },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload result is undefined'));
          resolve({ imageUrl: result.secure_url, imagePublicId: result.public_id });
        },
      );

      uploadStream.end(buffer);
    });
  }
  async deleteFile(publicId: string): Promise<void> {
    if (!publicId) return;

    try {
      const result = await cloudinary.uploader.destroy(publicId);
      console.log(result, 'delete');
      if (result.result !== 'ok' && result.result !== 'not found') {
        console.warn(`Failed to delete Cloudinary file: ${publicId}`, result);
      }
    } catch (err) {
      console.error(`Cloudinary delete error for ${publicId}:`, err);
    }
  }
}
