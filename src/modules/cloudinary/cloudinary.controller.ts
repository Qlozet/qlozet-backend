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
import { CloudinaryService } from '../cloudinary/cloudinary.service';
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
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  /**
   * 👤 Upload profile image
   */
  @Public()
  @Post('profile')
  @UseInterceptors(FileInterceptor('file'))
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
  @UseInterceptors(FileInterceptor('file'))
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
    FileFieldsInterceptor([
      { name: 'files', maxCount: 3 }, // adjust maxCount if needed
    ]),
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
