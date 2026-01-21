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
  Get,
  Param,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MeasurementService } from './measurement.service';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { RunPredictBodyDto, RunPredictSwaggerDto } from './dto/run-predict.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AutoMaskSwaggerDto } from './dto/auto-mask-predict.dto';
import { VideoPipelineSwaggerDto } from './dto/video-pipeline.dto';
import { Public } from 'src/common/decorators/public.decorator';
import * as multer from 'multer';
import { Roles } from 'src/common/decorators/roles.decorator';
import {
  GarmentConfigDto,
  GenerateOutfitRequestDto,
} from './dto/generate-outfit.dto';
import { OutfitQueueService } from './outfit-queue.service';
import { PlatformService } from '../platform/platform.service';
import { TokenService } from '../wallets/token.service';
import { UserService } from '../ums/services';
import {
  ActiveMeasurementSetDto,
  AddMeasurementSetDto,
} from './dto/user-measurement.dto';
import { EditGarmentDto } from './dto/edit-image.dto';
import { JobStatusService } from './job-status.service';
import { UserType } from '../ums/schemas';

@Controller('measurements')
@ApiTags('Measurements')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class MeasurementController {
  constructor(
    private readonly measurement: MeasurementService,
    private readonly outfitService: OutfitQueueService,
    private readonly jobService: JobStatusService,
    private readonly platformService: PlatformService,
    private readonly tokenService: TokenService,
    private readonly userService: UserService,
  ) {}

  @Public()
  // @Roles('customer')
  // @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Run predict with front and side images',
    type: RunPredictBodyDto,
  })
  @Post('run-prediction')
  // @UseInterceptors(FilesInterceptor('files'))
  async runPredict(@Body() body: RunPredictBodyDto, @Req() req: any) {
    try {
      const business = req.business?.id;
      const customer = req.user?.id;
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);

      if (tokenBalance < settings.run_prediction_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }
      return this.outfitService.queueRunPrediction({
        ...body,
        business: req.business?.id,
        customer: req.user?.id,
      });
    } catch (error) {
      throw new HttpException(
        error.message || 'Prediction failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles('customer')
  @Post('auto-mask-prediction')
  async autoMask(@Body() body: AutoMaskSwaggerDto, @Req() req: any) {
    try {
      const business = req.business?.id;
      const customer = req.user?.id;
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);

      if (tokenBalance < settings.image_measurement_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }
      return this.outfitService.queueAutoMask({
        ...body,
        business: req.business?.id,
        customer: req.user?.id,
      });
    } catch (error) {
      throw new HttpException(
        error.message || 'Auto mask prediction failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles('customer')
  @ApiBody({ type: VideoPipelineSwaggerDto })
  @Post('video-pipeline')
  async videoPipeline(@Body() body: VideoPipelineSwaggerDto, @Req() req: any) {
    try {
      const business = req.business?.id;
      const customer = req.user?.id;
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);
      if (tokenBalance < settings.video_measurement_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }
      return this.outfitService.queueVideoPipeline({
        ...body,
        business,
        customer,
      });
    } catch (error) {
      console.error('Video pipeline controller error:', error);
      throw new HttpException(
        error.message || 'Video processing failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles('customer')
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

      return await this.measurement.generateAvatar({
        ui_gender,
        pred_json: json,
      });
    } catch (error) {
      throw new HttpException(
        error.message || 'Avatar generation failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Post('generate-outfit')
  @ApiBody({
    description: 'Generate outfit using image URLs',
    schema: {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          description: 'Garment configuration object',
          example: {
            garmentType: 'dress',
            gender: 'female',
            view: 'front',
            occasion: 'wedding',
            aestheticKeywords: ['elegant', 'modern'],
            fit: 'tailored',
            fitNotes: 'Slightly loose at waist',
            fabricRefId: 'fabric_12345',
            embroideryRefId: 'embro_98765',
            hasStrictEmbroidery: false,
            measurementProfile: {
              height: 165,
              bust: 90,
              waist: 70,
              hips: 95,
            },
            constructionSelections: {
              neckline: 'V-neck',
              sleeve_style: 'short sleeve',
            },
            inspirationImageUrls: [
              'https://example.com/image1.jpg',
              'https://example.com/image2.jpg',
            ],
            silhouetteImageUrl: 'https://example.com/silhouette.jpg',
          },
        },
        userPrompt: {
          type: 'string',
          description: 'Optional user prompt',
          example: 'Make it elegant and modern',
        },
        reference_image_urls: {
          type: 'array',
          description: 'Image URLs instead of uploaded files',
          items: { type: 'string', format: 'url' },
          example: [
            'https://res.cloudinary.com/.../img1.jpg',
            'https://res.cloudinary.com/.../img2.jpg',
          ],
        },
      },
    },
  })
  async generateOutfit(
    @Body('config') config: GarmentConfigDto,
    @Req() req: any,
    @Body('userPrompt') userPrompt?: string,
    @Body('reference_image_urls') reference_image_urls?: string[],
  ) {
    const business = req.business?.id;
    const customer = req.user?.id;
    const [settings, tokenBalance] = await Promise.all([
      this.platformService.getSettings(),
      this.tokenService.balance(business, customer),
    ]);
    if (tokenBalance < settings.outfit_generation_token_price) {
      throw new BadRequestException(
        'Insufficient tokens, please fund your wallet',
      );
    }
    const payload: GenerateOutfitRequestDto = {
      config,
      user_prompt: userPrompt,
      reference_image_urls,
    };

    return this.outfitService.queueOutfitGeneration(payload);
  }

  @Public()
  @Post('edit-garment-image')
  async editGarmentImage(@Body() payload: EditGarmentDto, @Req() req: any) {
    const business = req.business?.id;
    const customer = req.user?.id;

    const [settings, tokenBalance] = await Promise.all([
      this.platformService.getSettings(),
      this.tokenService.balance(business, customer),
    ]);
    if (tokenBalance < settings.edit_garment_token_price) {
      throw new BadRequestException(
        'Insufficient tokens, please fund your wallet',
      );
    }
    return this.outfitService.queueEditGarmentGeneration({
      ...payload,
      business,
      customer,
    });
    // return this.measurement.editGarmentWithImageEditor(payload);
  }

  @Post('users')
  @ApiOperation({ summary: 'Add a new measurement set for a user' })
  @ApiResponse({ status: 201, type: ActiveMeasurementSetDto })
  async addMeasurement(@Body() dto: AddMeasurementSetDto, @Req() req: any) {
    return this.userService.addMeasurementSet(req.user.id, dto);
  }
  @Roles(UserType.CUSTOMER)
  @Get('users/active')
  @ApiOperation({ summary: 'Get active measurement set for a user' })
  @ApiResponse({ status: 200, type: ActiveMeasurementSetDto })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 400, description: 'No active measurement set found' })
  async getActiveMeasurements(@Req() req: any) {
    return this.userService.getActiveMeasurementSet(req.user.id);
  }
  @Public()
  @Get('job/:job_id')
  async getJobStatus(@Param('job_id') jobId: string) {
    return await this.jobService.findByJobId(jobId);
  }
}
