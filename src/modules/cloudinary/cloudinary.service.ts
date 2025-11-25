import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { MulterFile } from 'src/common/types/upload';

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
          });
        },
      );

      uploadStream.end(buffer);
    });
  }

  async uploadFile(
    file: MulterFile,
    folderName: string,
  ): Promise<{ fileUrl: string; filePublicId: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folderName,
          resource_type: 'auto',
        },
        (error, result) => {
          if (error) {
            return reject(error);
          }
          if (!result) {
            return reject(new Error('Upload result is undefined'));
          }
          resolve({ fileUrl: result.url, filePublicId: result.public_id });
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
          resolve({ imageUrl: result.url, imagePublicId: result.public_id });
        },
      );

      uploadStream.end(buffer);
    });
  }
  async deleteFile(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
