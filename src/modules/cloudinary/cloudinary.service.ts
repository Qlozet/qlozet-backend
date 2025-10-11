import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { MulterFile } from 'src/common/types/upload';

@Injectable()
export class CloudinaryService {
  async uploadImage(
    file: MulterFile,
    folderName: string,
  ): Promise<{ imageUrl: string; imagePublicId: string }> {
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
          resolve({ imageUrl: result.url, imagePublicId: result.public_id });
        },
      );

      uploadStream.end(file.buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId);
  }
}
