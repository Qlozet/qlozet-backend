import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  UseGuards,
  ValidationPipe,
  UsePipes,
  Req,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MeasurementService } from './measurement.service';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { RunPredictBodyDto, RunPredictSwaggerDto } from './dto/run-predict.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AutoMaskSwaggerDto } from './dto/auto-mask-predict.dto';
import { VideoPipelineSwaggerDto } from './dto/video-pipeline.dto';
import { Public } from 'src/common/decorators/public.decorator';
import * as multer from 'multer';

@Controller('measurements')
@ApiTags('Measurements')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class MeasurementController {
  constructor(private readonly measurement: MeasurementService) {}

  @Public()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Run predict with front and side images',
    type: RunPredictSwaggerDto,
  })
  @Post('run-predict')
  @UseInterceptors(FilesInterceptor('files'))
  async runPredict(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: RunPredictBodyDto,
  ) {
    try {
      if (!files || files.length === 0) {
        throw new BadRequestException('No files uploaded');
      }

      const front = files.find((f) => f.fieldname === 'front_image');
      const side = files.find((f) => f.fieldname === 'side_image');

      if (!front) {
        throw new BadRequestException('Front image is required');
      }

      return await this.measurement.runPredict(
        front,
        side as Express.Multer.File,
        body,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Prediction failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @ApiConsumes('multipart/form-data')
  @Post('auto-mask-predict')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'bg', maxCount: 1 },
      { name: 'front', maxCount: 1 },
      { name: 'side', maxCount: 1 },
    ]),
  )
  async autoMask(
    @UploadedFiles()
    files: {
      bg?: Express.Multer.File[];
      front?: Express.Multer.File[];
      side?: Express.Multer.File[];
    },
    @Body() body: AutoMaskSwaggerDto,
  ) {
    try {
      const bg = files.bg?.[0];
      const front = files.front?.[0];
      const side = files.side?.[0];

      if (!front) {
        throw new BadRequestException('Front image is required');
      }

      return await this.measurement.autoMaskPredict(
        bg as Express.Multer.File,
        front,
        side as Express.Multer.File,
        body,
      );
    } catch (error) {
      throw new HttpException(
        error.message || 'Auto mask prediction failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: VideoPipelineSwaggerDto })
  @Post('video-pipeline')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB limit
      },
      fileFilter: (req, file, callback) => {
        // Validate video file types
        const allowedMimeTypes = [
          'video/mp4',
          'video/avi',
          'video/mov',
          'video/wmv',
          'video/flv',
          'video/webm',
          'video/quicktime',
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
          callback(null, true);
        } else {
          callback(
            new HttpException(
              `Unsupported file type: ${file.mimetype}. Allowed types: ${allowedMimeTypes.join(', ')}`,
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
      },
    }),
  )
  async videoPipeline(
    @UploadedFile() video: Express.Multer.File,
    @Body() body: VideoPipelineSwaggerDto,
  ) {
    try {
      if (!video) {
        throw new BadRequestException('Video file is required');
      }

      console.log('Received video:', {
        originalname: video.originalname,
        size: video.size,
        mimetype: video.mimetype,
        bufferLength: video.buffer?.length,
      });

      return this.measurement.videoPipeline(video, body);
    } catch (error) {
      console.error('Video pipeline controller error:', error);
      throw new HttpException(
        error.message || 'Video processing failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('avatar')
  @UseInterceptors(FileInterceptor('pred_json'))
  async avatar(
    @UploadedFile() json: Express.Multer.File,
    @Body('ui_gender') ui_gender: string = 'neutral',
  ) {
    try {
      if (!json) {
        throw new BadRequestException('Prediction JSON file is required');
      }

      return await this.measurement.generateAvatar(json, ui_gender);
    } catch (error) {
      throw new HttpException(
        error.message || 'Avatar generation failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
