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
  Patch,
  Delete,
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
  UpdateMeasurementSetDto,
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

  @Roles(UserType.CUSTOMER)
  @ApiBody({
    description: 'Run predict with front and side images',
    type: RunPredictBodyDto,
  })
  @Post('run-prediction')
  async runPredict(@Body() body: RunPredictBodyDto, @Req() req: any) {
    try {
      const business = req.business?.id;
      const customer = req.user?.id;

      // Call Gradio synchronously — tabular prediction is fast (~1-2s).
      // Bypasses BullMQ queue to avoid MongoDB stale-connection issues on Fly.io.
      const result = await this.measurement.runPrediction({
        ...body,
        business,
        customer,
      });

      return result;
    } catch (error) {
      throw new HttpException(
        error.message || 'Prediction failed',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserType.CUSTOMER)
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

  @Roles(UserType.CUSTOMER)
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

  @Roles(UserType.CUSTOMER)
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

  @Roles(UserType.CUSTOMER)
  @Post('analyze-reference')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({
    summary: 'Analyze a reference image to extract style metadata and suggested prompt',
    description:
      'Upload a reference photo or provide a Cloudinary URL. ' +
      'Returns a jobId — poll GET /measurement/job/:jobId for the result. ' +
      'Result contains: suggested_prompt, metadata, matched_styles (mapped to platform style IDs).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Reference image file (JPEG/PNG)',
        },
        image_url: {
          type: 'string',
          description: 'Cloudinary URL of the reference image (alternative to file upload)',
          example: 'https://res.cloudinary.com/.../reference.jpg',
        },
        provider: {
          type: 'string',
          description: 'AI provider',
          default: 'openai',
        },
        model: {
          type: 'string',
          description: 'AI model for analysis',
          default: 'gpt-5.5',
        },
      },
    },
  })
  async analyzeReference(
    @UploadedFile() file: Express.Multer.File,
    @Body('image_url') imageUrl?: string,
    @Body('provider') provider?: string,
    @Body('model') model?: string,
    @Req() req?: any,
  ) {
    if (!file && !imageUrl) {
      throw new BadRequestException('Provide either a file upload or image_url');
    }

    // Token check
    const business = req?.business?.id;
    const customer = req?.user?.id;
    const [settings, tokenBalance] = await Promise.all([
      this.platformService.getSettings(),
      this.tokenService.balance(business, customer),
    ]);

    const price = (settings as any).analyze_reference_token_price ?? 10;
    if (tokenBalance < price) {
      throw new BadRequestException(
        'Insufficient tokens, please fund your wallet',
      );
    }

    // If file uploaded, upload to Cloudinary first to get a stable URL
    let finalImageUrl = imageUrl;
    if (file) {
      const uploaded = await this.measurement.uploadBufferToCloudinary(
        file.buffer,
        file.mimetype,
      );
      finalImageUrl = uploaded;
    }

    return this.outfitService.queueAnalyzeReference({
      imageUrl: finalImageUrl,
      provider,
      model,
    });
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

  @Roles(UserType.CUSTOMER)
  @Get('users/sets')
  @ApiOperation({ summary: 'Get all saved measurement sets for a user' })
  @ApiResponse({
    status: 200,
    description: 'List of all measurement sets',
  })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getAllMeasurementSets(@Req() req: any) {
    return this.userService.getAllMeasurementSets(req.user.id);
  }

  @Roles(UserType.CUSTOMER)
  @Get('users/sets/:name')
  @ApiOperation({ summary: 'Get a specific measurement set by name' })
  @ApiParam({ name: 'name', description: 'Name of the measurement set' })
  @ApiResponse({
    status: 200,
    description: 'Measurement set details',
    type: ActiveMeasurementSetDto,
  })
  @ApiResponse({ status: 404, description: 'Measurement set not found' })
  async getMeasurementSetByName(
    @Param('name') name: string,
    @Req() req: any,
  ) {
    return this.userService.getMeasurementSetByName(req.user.id, name);
  }

  @Roles(UserType.CUSTOMER)
  @Patch('users/sets/:name/activate')
  @ApiOperation({ summary: 'Set a measurement set as the active one' })
  @ApiParam({ name: 'name', description: 'Name of the measurement set to activate' })
  @ApiResponse({ status: 200, description: 'Measurement set activated' })
  @ApiResponse({ status: 404, description: 'Measurement set not found' })
  async activateMeasurementSet(
    @Param('name') name: string,
    @Req() req: any,
  ) {
    return this.userService.setActiveMeasurementSet(req.user.id, name);
  }

  @Roles(UserType.CUSTOMER)
  @Patch('users/sets/:name')
  @ApiOperation({ summary: 'Update a measurement set by name' })
  @ApiParam({ name: 'name', description: 'Name of the measurement set to update' })
  @ApiResponse({ status: 200, description: 'Measurement set updated' })
  @ApiResponse({ status: 404, description: 'Measurement set not found' })
  async updateMeasurementSet(
    @Param('name') name: string,
    @Body() dto: UpdateMeasurementSetDto,
    @Req() req: any,
  ) {
    return this.userService.updateMeasurementSet(req.user.id, name, dto);
  }

  @Roles(UserType.CUSTOMER)
  @Delete('users/sets/:name')
  @ApiOperation({ summary: 'Delete a measurement set by name' })
  @ApiParam({ name: 'name', description: 'Name of the measurement set to delete' })
  @ApiResponse({ status: 200, description: 'Measurement set deleted' })
  @ApiResponse({ status: 404, description: 'Measurement set not found' })
  async deleteMeasurementSet(
    @Param('name') name: string,
    @Req() req: any,
  ) {
    return this.userService.deleteMeasurementSet(req.user.id, name);
  }

  @Public()
  @Get('job/:job_id')
  async getJobStatus(@Param('job_id') jobId: string) {
    return await this.jobService.findByJobId(jobId);
  }
}
