import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  UseGuards,
  UploadedFiles,
} from '@nestjs/common';
import {
  FileFieldsInterceptor,
  FileInterceptor,
} from '@nestjs/platform-express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  PlatformSettings,
  PlatformSettingsDocument,
} from '../platform/schema/platformSettings.schema';
import { MulterFile } from '../../common/types/upload';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import {
  assertValidImage,
  imageUploadOptions,
  IMAGE_UPLOAD,
} from '../../common/validation/image-upload';

@ApiTags('Uploads')
@ApiBearerAuth('access-token')
// @UseGuards(JwtAuthGuard)
// The global limits (3/s, 20/10s) are tuned for JSON endpoints and choke
// multi-image flows — creating a clothing product uploads default images plus
// one per size variant back-to-back, and the console 429s midway. Uploads are
// naturally paced by file transfer, so allow bursts while keeping a ceiling.
@Throttle({
  short: { ttl: 1000, limit: 15 },
  medium: { ttl: 10000, limit: 60 },
  long: { ttl: 60000, limit: 200 },
})
@Controller('uploads')
export class UploadController {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    @InjectModel(PlatformSettings.name)
    private readonly platformSettingsModel: Model<PlatformSettingsDocument>,
  ) {}

  /**
   * Admin-tunable image limits. Falls back to the code constants when the
   * settings document is missing or unreadable — a settings problem must never
   * stop a vendor uploading.
   */
  private async imageLimits(): Promise<{
    maxBytes: number;
    minShortEdge: number;
  }> {
    const settings: any = await this.platformSettingsModel
      .findOne()
      .lean()
      .catch(() => null);

    const maxMb = Number(settings?.product_image_max_mb);
    const minEdge = Number(settings?.product_image_min_short_edge);

    return {
      maxBytes:
        Number.isFinite(maxMb) && maxMb > 0
          ? maxMb * 1024 * 1024
          : IMAGE_UPLOAD.MAX_BYTES,
      // 0 is a deliberate "disable the check", so only fall back when the
      // value is absent or nonsense — not when it is a legitimate zero.
      minShortEdge:
        Number.isFinite(minEdge) && minEdge >= 0
          ? minEdge
          : IMAGE_UPLOAD.MIN_PRODUCT_SHORT_EDGE,
    };
  }

  /**
   * 👤 Upload profile image
   */
  @Public()
  @Post('profile')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload a profile image',
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The image file to upload',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Profile image uploaded successfully',
  })
  async uploadProfileImage(@UploadedFile() file: MulterFile) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { maxBytes } = await this.imageLimits();
    // No minimum dimension — a logo or avatar is legitimately small.
    assertValidImage(file, { label: 'profile image', maxBytes });

    const result = await this.cloudinaryService.uploadFile(file, 'profiles');
    return {
      message: 'Profile image uploaded successfully',
      data: {
        imageUrl: result.fileUrl,
        publicId: result.filePublicId,
      },
    };
  }

  /**
   * 🛍️ Upload product image
   */
  @Post('product')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload a product image',
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The product image file to upload',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Product image uploaded successfully',
  })
  async uploadProductImage(@UploadedFile() file: MulterFile) {
    if (!file) throw new BadRequestException('No file uploaded');
    const { maxBytes, minShortEdge } = await this.imageLimits();
    // Product photos carry the storefront, so these get the resolution floor.
    assertValidImage(file, { label: 'product photo', maxBytes, minShortEdge });

    const result = await this.cloudinaryService.uploadFile(file, 'products');
    return {
      message: 'Product image uploaded successfully',
      data: {
        imageUrl: result.fileUrl,
        publicId: result.filePublicId,
      },
    };
  }

  @Post('outfits')
  @UseInterceptors(
    FileFieldsInterceptor(
      [{ name: 'files', maxCount: 3 }],
      imageUploadOptions,
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Upload one or more outfit images',
    required: true,
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Outfit image files to upload',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Outfit images uploaded successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Outfit images uploaded successfully',
        },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              imageUrl: {
                type: 'string',
                example:
                  'https://res.cloudinary.com/demo/image/upload/v123/outfit1.jpg',
              },
              publicId: { type: 'string', example: 'outfits/abc123' },
            },
          },
        },
      },
    },
  })
  async uploadOutfitImages(@UploadedFiles() files: { files?: MulterFile[] }) {
    const uploadedFiles = files.files || [];
    if (!uploadedFiles.length)
      throw new BadRequestException('No files uploaded');

    // Reference shots for AI generation — a phone snap is fine, so these are
    // checked for type and size but not resolution. Validate all of them
    // before uploading any, so a bad third file doesn't leave two orphans in
    // Cloudinary.
    const { maxBytes: refMaxBytes } = await this.imageLimits();
    uploadedFiles.forEach((file) =>
      assertValidImage(file, { label: 'reference image', maxBytes: refMaxBytes }),
    );

    const results = await Promise.all(
      uploadedFiles.map((file) =>
        this.cloudinaryService.uploadFile(file, 'outfits'),
      ),
    );

    return {
      message: 'Outfit images uploaded successfully',
      data: results.map((r) => ({
        imageUrl: r.fileUrl,
        publicId: r.filePublicId,
      })),
    };
  }
}
