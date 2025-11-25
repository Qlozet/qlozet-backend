import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
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

@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);
  private readonly hbm = 'Qlozet/hybrid_body_measurement_mask';
  private readonly ig = 'Qlozet/qlozet-image-generator-memory';
  constructor(
    private readonly gradio: GradioService,
    private readonly cloudinary: CloudinaryService,
    private readonly tokenService: TokenService,
    private readonly platformService: PlatformService,
  ) {}

  async generateOutfitImageFromConfig({ payload }: any) {
    try {
      const { config, user_prompt, reference_image_urls = [] } = payload;
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

  async autoMaskPredict(
    bg: Express.Multer.File,
    front: Express.Multer.File,
    side: Express.Multer.File,
    body: any,
    business?: string,
    customer?: string,
  ) {
    if (!front) throw new BadRequestException('Front image is required');
    const [settings, tokenBalance] = await Promise.all([
      this.platformService.getSettings(),
      this.tokenService.balance(business, customer),
    ]);
    if (tokenBalance < settings.image_token_price) {
      throw new BadRequestException('Insufficient tokens');
    }

    const client = await this.gradio.getClient(this.hbm);

    const result = await client.predict('/_auto_mask_and_predict', {
      model_choice: body.model_choice || 'Hybrid (CNN+Tabular)',
      method: body.method || 'hybrid',
      bg: bg ? this.gradio.bufferToBlob(bg.buffer, bg.mimetype) : null,
      front: this.gradio.bufferToBlob(front.buffer, front.mimetype),
      side: side ? this.gradio.bufferToBlob(side.buffer, side.mimetype) : null,
      height_cm: Number(body.height_cm) || 175,
      weight: Number(body.weight) || 0,
      gender: body.gender || '',
      mp_t: Number(body.mp_t) || 0.1,
      de_top: Number(body.de_top) || 0.3,
      de_bottom: Number(body.de_bottom) || 0.1,
      t_boost: Number(body.t_boost) || 1.1,
    });
    await this.tokenService.spend('image', business, customer);

    return {
      generated_masks: { front: result.data[0], side: result.data[1] },
      predictions_table: result.data[2],
      predictions_json: result.data[3],
    };
  }

  async generateAvatar(
    predJson: Express.Multer.File,
    ui_gender: string = 'neutral',
  ) {
    if (!predJson)
      throw new BadRequestException('Prediction JSON file is required');
    const client = await this.gradio.getClient(this.hbm);

    const result = await client.predict('/_avatar_from_last_preds', {
      out_json_path: this.gradio.bufferToBlob(
        predJson.buffer,
        'application/json',
      ),
      ui_gender,
    });

    const saved = await this.gradio.saveFile(result.data, 'tmp/avatars');
    return { avatar_file: result.data, saved_path: saved };
  }

  async videoPipeline(
    video: Express.Multer.File,
    body: any,
    business?: string,
    customer?: string,
  ) {
    try {
      if (!video) throw new BadRequestException('Video file is required');
      if (!video.buffer)
        throw new BadRequestException('Uploaded file has no buffer');

      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);
      if (tokenBalance < settings.video_token_price) {
        throw new BadRequestException('Insufficient tokens');
      }

      const { fileUrl, filePublicId } = await this.cloudinary.uploadFile(
        video,
        'Measurements',
      );

      const client = await this.gradio.getClient(this.hbm);

      const result = await client.predict('/_video_pipeline_url', {
        video_url: fileUrl,
        method: body.method || 'mp',
        mp_t: Number(body.mp_t) || 0.12,
        height_cm: Number(body.height_cm) || 175,
        model_choice: body.model_choice || 'Hybrid (CNN+Tabular)',
        want_back: body.want_back !== 'false',
        weight_val: Number(body.weight) || 0,
        gender_val: body.gender || '',
        want_mesh_flag: false,
      });

      this.logger.log('Video pipeline prediction completed successfully');
      this.cloudinary.deleteFile(filePublicId);
      await this.tokenService.spend('video', business, customer);
      return result.data;
    } catch (error) {
      this.logger.error('Video pipeline error:', error);
      throw new InternalServerErrorException(
        `Video processing failed: ${error.message}`,
      );
    }
  }
}
