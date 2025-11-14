import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

@ApiTags('Uploads')
@ApiBearerAuth('access-token')
// @UseGuards(JwtAuthGuard)
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
}
