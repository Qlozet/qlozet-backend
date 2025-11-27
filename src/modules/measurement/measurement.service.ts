import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { GradioService } from './gradio.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { handle_file } from '@gradio/client';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { TokenService } from '../wallets/token.service';
import { PlatformService } from '../platform/platform.service';
import { GenerateOutfitRequestDto } from './dto/generate-outfit.dto';
import { buildMetadataFromConfig } from './util/metadata-builder';
import { buildPrompt } from './util/constructionBuilder';
import { VideoPipelineSwaggerDto } from './dto/video-pipeline.dto';
import {
  AutoMaskPredictBodyDto,
  AutoMaskSwaggerDto,
} from './dto/auto-mask-predict.dto';
import { AvatarDto } from './dto/avatar.dto';
import { EditGarmentDto } from './dto/edit-image.dto';

@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);
  private readonly hbm = 'Qlozet/hybrid_body_measurement_mask';
  private readonly ig = 'Qlozet/qlozet-image-generator-memory';
  private readonly ie = 'Qlozet/Image-editor';
  constructor(
    private readonly gradio: GradioService,
    private readonly cloudinary: CloudinaryService,
    private readonly tokenService: TokenService,
    private readonly platformService: PlatformService,
  ) {}

  async generateOutfitImageFromConfig(params: GenerateOutfitRequestDto) {
    try {
      const { config, user_prompt, reference_image_urls = [] } = params;
      const metadataObj = buildMetadataFromConfig(config);
      const metadataJson = JSON.stringify(metadataObj);
      const prompt = buildPrompt(user_prompt);
      const view = config.view ?? 'front';
      const client = await this.gradio.getClient(this.ig);

      const result = await client.predict('/generate_handler', {
        prompt,
        view,
        image_inputs: reference_image_urls.join(','),
        metadata_json: metadataJson,
      });

      // Return generated image path
      const dataUrl = result.data[0] as string;
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const uploadResult = await this.cloudinary.uploadBase64(
        base64,
        'outfits',
      );
      this.logger.log('Outfit generation completed successfully');
      return uploadResult;
    } catch (error) {
      console.error('Error generating outfit image:', error);
      throw new Error('Failed to generate outfit image. Please try again.');
    }
  }

  async runPredict(
    frontFile: Express.Multer.File,
    sideFile: Express.Multer.File,
    body: any,
  ) {
    if (!frontFile) throw new BadRequestException('Front image is required');
    const client = await this.gradio.getClient(this.hbm);

    const result = await client.predict('/run_predict', {
      model_choice: body.model_choice || 'Hybrid (CNN+Tabular)',
      front_image: this.gradio.bufferToBlob(
        frontFile.buffer,
        frontFile.mimetype,
      ),
      side_image: sideFile
        ? this.gradio.bufferToBlob(sideFile.buffer, sideFile.mimetype)
        : null,
      height_cm: Number(body.height_cm) || 175,
      weight: Number(body.weight) || 0,
      gender: body.gender || '',
    });

    return {
      predictions_table: result.data[0],
      predictions_json: result.data[1],
    };
  }

  async autoMaskPredict(params: AutoMaskSwaggerDto) {
    try {
      const { gender, bg, front, side, height_cm, weight, business, customer } =
        params;

      // Uncomment this when token logic is ready:
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);

      if (tokenBalance < settings.image_measurement_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }

      const client = await this.gradio.getClient(this.hbm);

      const result = await client.predict('//_auto_mask_and_predict_url', {
        model_choice: 'Hybrid (CNN+Tabular)',
        method: 'hybrid',
        bg_url: bg || null,
        front_url: front,
        side_url: side || null,
        height_cm: Number(height_cm) || 175,
        weight: Number(weight) || 0,
        gender,
        mp_t: 0.1,
        de_top: 0.3,
        de_bottom: 0.1,
        t_boost: 1.1,
      });

      // // Uncomment this when ready:
      await this.tokenService.spend('image', business, customer);
      await Promise.all(
        [bg, side, front]
          .filter((file) => !!file)
          .map(async (file) => {
            const publicId = this.cloudinary.getCloudinaryPublicId(file);
            await this.cloudinary.deleteFile(publicId);
          }),
      );

      return result?.data[2];
    } catch (error) {
      // Expected and safe errors
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      // Gradio / model errors
      if (
        error?.message?.includes('gradio') ||
        error?.message?.includes('predict')
      ) {
        throw new InternalServerErrorException(
          'Model prediction failed. Please try again.',
        );
      }

      // Generic fallback
      throw new InternalServerErrorException(
        'Failed to process image measurement.',
      );
    }
  }

  async generateAvatar(params: AvatarDto) {
    if (!params.pred_json)
      throw new BadRequestException('Prediction JSON file is required');
    const client = await this.gradio.getClient(this.hbm);

    const result = await client.predict('/_avatar_from_last_preds', {
      out_json_path: this.gradio.bufferToBlob(
        params.pred_json.buffer,
        'application/json',
      ),
      ui_gender: params.ui_gender,
    });

    const saved = await this.gradio.saveFile(result.data, 'tmp/avatars');
    return { avatar_file: result.data, saved_path: saved };
  }

  async videoPipeline(params: VideoPipelineSwaggerDto) {
    const {
      video_url,
      business,
      customer,
      method,
      mp_t,
      height_cm,
      weight,
      want_back,
      want_mesh_flag,
      gender,
    } = params;
    try {
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);
      if (tokenBalance < settings.video_measurement_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }

      const client = await this.gradio.getClient(this.hbm);

      const result = await client.predict('/_video_pipeline_url', {
        video_url,
        method: method || 'mp',
        mp_t: Number(mp_t) || 0.12,
        height_cm: Number(height_cm) || 175,
        model_choice: 'Hybrid (CNN+Tabular)',
        want_back,
        weight_val: Number(weight) || 0,
        gender_val: gender || '',
        want_mesh_flag,
      });

      await this.tokenService.spend('video', business, customer);
      this.logger.log('Video pipeline prediction completed successfully');
      return result.data;
    } catch (error) {
      this.logger.error('Video pipeline error:', error.message);
      throw new InternalServerErrorException(
        `Video processing failed: ${error.message}`,
      );
    }
  }
  async editGarmentWithImageEditor(payload: EditGarmentDto) {
    try {
      const {
        base_image_url,
        fabric_image_url = '',
        accessory_image_url = '',
        addon_image_url = '',
        garment_type = "women's flare mini dress",
        base_color = '',
        pattern = '',
        fit = 'tailored',
        style_notes = '',
        metadata_json,
        business,
        customer,
      } = payload;

      if (!base_image_url) {
        throw new BadRequestException('base_image_url is required');
      }
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);
      if (tokenBalance < settings.edit_garment_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }
      const client = await this.gradio.getClient(this.ie);

      // Call the editor endpoint
      const result = await client.predict('/edit_product_image_from_urls', {
        base_url: base_image_url,
        fabric_url: fabric_image_url || '',
        accessory_url: accessory_image_url || '',
        addon_url: addon_image_url || '',
        garment_type,
        base_color,
        pattern,
        fit,
        style_notes,
        metadata_json: metadata_json ? JSON.stringify(metadata_json) : '',
        model_name: 'gemini-2.5-flash-image',
        aspect_ratio: '1:1',
        resolution: '1K',
      });

      // Extract results

      const editedImagePath = result?.data?.[0] as string;
      const statusText = (result?.data?.[1] as string) || '';
      const base64Image = (result?.data?.[2] as string) || '';
      if (!editedImagePath) {
        throw new InternalServerErrorException(
          `Image editor returned no image. Status: ${statusText}`,
        );
      }

      const uploadedImage = await this.cloudinary.uploadBase64(
        base64Image,
        'outfits',
      );

      await this.tokenService.spend('edit', business, customer);
      this.logger.log('Edit garment completed successfully');
      return uploadedImage;
    } catch (error) {
      console.error('IMAGE EDIT ERROR:', error);

      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Image editing failed. Please try again.',
      );
    }
  }
}
