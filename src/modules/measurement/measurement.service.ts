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
import { StyleLibraryService } from '../style-library/style-library.service';
import { VideoPipelineSwaggerDto } from './dto/video-pipeline.dto';
import {
  AutoMaskPredictBodyDto,
  AutoMaskSwaggerDto,
} from './dto/auto-mask-predict.dto';
import { AvatarDto } from './dto/avatar.dto';
import { EditGarmentDto } from './dto/edit-image.dto';
import { RunPredictBodyDto } from './dto/run-predict.dto';

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
    private readonly styleLibrary: StyleLibraryService,
  ) {}

  async generateOutfitImageFromConfig(params: GenerateOutfitRequestDto) {
    try {
      const { config, user_prompt, reference_image_urls = [] } = params;
      const metadataObj = buildMetadataFromConfig(config);
      const metadataJson = JSON.stringify(metadataObj);
      const prompt = buildPrompt(user_prompt);
      const view = config.view ?? 'front';
      const client = await this.gradio.getClient(this.ig);

      // Download reference images and convert to blob for Gradio
      let imageUploads: any[] = [];
      if (reference_image_urls.length > 0) {
        for (const url of reference_image_urls) {
          try {
            // Use handle_file for proper Gradio file handling
            const fileRef = await handle_file(url);
            imageUploads.push(fileRef);
            this.logger.log(`Added reference image via handle_file: ${url}`);
          } catch (err) {
            this.logger.warn(`Failed to handle reference image: ${url} — ${err?.message}`);
          }
        }
      }

      // Log what we're sending to Gradio
      this.logger.log(`Gradio /generate_handler call:`);
      this.logger.log(`  prompt: ${prompt.slice(0, 100)}...`);
      this.logger.log(`  view: ${view}`);
      this.logger.log(`  image_inputs: ${reference_image_urls.join(',') || '(empty)'}`);
      this.logger.log(`  image_uploads: ${imageUploads.length} file(s)`);
      this.logger.log(`  metadata_json_str: ${metadataJson.slice(0, 200)}...`);
      this.logger.log(`  provider: openai, model: gpt-image-1`);

      const result = await client.predict('/generate_handler', {
        prompt,
        view,
        image_inputs: reference_image_urls.join(',') || '',
        image_uploads: imageUploads,
        metadata_json_str: metadataJson,
        provider: 'openai',
        model: 'gpt-image-1',
      });

      this.logger.log(`Gradio result keys: ${JSON.stringify(Object.keys(result))}`);
      this.logger.log(`Gradio result.data length: ${result.data?.length}`);

      // Return generated image — result.data[0] is data URL, result.data[1] is image path
      const dataUrl = result.data[0] as string;
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
      const uploadResult = await this.cloudinary.uploadBase64(
        base64,
        'outfits',
      );
      this.logger.log('Outfit generation completed successfully');
      return uploadResult;
    } catch (error) {
      this.logger.error(`Outfit generation error: ${JSON.stringify(error, null, 2)}`);
      this.logger.error(`Error message: ${error?.message || 'unknown'}`);
      this.logger.error(`Error stage: ${error?.stage || 'unknown'}`);
      throw new Error(`Failed to generate outfit image: ${error?.message || error?.stage || 'unknown error'}`);
    }
  }

  async runPrediction(body: RunPredictBodyDto) {
    const { business, customer } = body;
    try {
      const [settings, tokenBalance] = await Promise.all([
        this.platformService.getSettings(),
        this.tokenService.balance(business, customer),
      ]);

      if (tokenBalance < settings.run_prediction_token_price) {
        throw new BadRequestException(
          'Insufficient tokens, please fund your wallet',
        );
      }

      // Pre-deduct tokens BEFORE the Gradio call.
      // MongoDB connection is fresh now; after Gradio it may go stale.
      await this.tokenService.spend('prediction', business, customer);

      const client = await this.gradio.getClient(this.hbm);

      this.logger.log(
        `Running prediction: height=${body.height_cm}, weight=${body.weight}, gender=${body.gender}`,
      );

      const result = await client.predict('//run_predict', {
        model_choice: 'Tabular (LightGBM)',
        front_image: null,
        side_image: null,
        height_cm: Number(body.height_cm) || 175,
        weight: Number(body.weight) || 0,
        gender: body.gender || '',
      });

      this.logger.log(
        `Prediction result shape: ${JSON.stringify(Object.keys(result || {}))}`,
      );
      this.logger.log(
        `result.data length: ${result?.data?.length}, result.data[0] type: ${typeof result?.data?.[0]}`,
      );

      this.logger.log('Prediction completed successfully');
      return result.data[0];
    } catch (error) {
      // Re-throw known NestJS exceptions with correct HTTP status
      if (error instanceof BadRequestException) throw error;

      const errMsg =
        error?.message ||
        error?.detail ||
        (typeof error === 'string' ? error : JSON.stringify(error));
      this.logger.error(`Prediction failed: ${errMsg}`, error?.stack);
      throw new Error(`Prediction Error: ${errMsg}`);
    }
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
      // NOTE: token gating + deduction is owned by the controller
      // (edit-garment-image checks balance and pre-deducts before queuing).
      // This method must NOT re-check or re-spend, otherwise the job is
      // double-charged, and a customer who paid their exact balance would
      // fail the redundant check here.
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

      // Tokens were already deducted by the controller before queuing — do not
      // spend again here (would double-charge).
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

  /**
   * Upload a raw buffer to Cloudinary and return the URL.
   * Used by the controller to persist file uploads before queueing.
   */
  async uploadBufferToCloudinary(
    buffer: Buffer,
    mimetype: string,
  ): Promise<string> {
    const base64 = buffer.toString('base64');
    const result: any = await this.cloudinary.uploadBase64(base64, 'references');
    return result.secure_url || result.url;
  }

  // ════════════════════════════════════════════════════════════════
  //  ANALYZE REFERENCE IMAGE
  // ════════════════════════════════════════════════════════════════

  /**
   * Analyze a reference image using Gradio /analyze_handler.
   * Returns a suggested prompt and extracted metadata JSON.
   */
  async analyzeReferenceImage(params: {
    imageUrl?: string;
    imageBlob?: Blob;
    provider?: string;
    model?: string;
  }) {
    try {
      const client = await this.gradio.getClient(this.ig);

      // Build image input — either from uploaded blob or URL download
      let imageNp: Blob;
      if (params.imageBlob) {
        imageNp = params.imageBlob;
        this.logger.log(`Using uploaded blob (${imageNp.size} bytes)`);
      } else if (params.imageUrl) {
        const response = await fetch(params.imageUrl);
        const buffer = await response.arrayBuffer();
        imageNp = new Blob([buffer], { type: 'image/png' });
        this.logger.log(`Downloaded reference image (${buffer.byteLength} bytes)`);
      } else {
        throw new BadRequestException('Either image_url or file upload is required');
      }

      const provider = params.provider || process.env.ANALYZE_PROVIDER || 'openai';
      const model = params.model || process.env.ANALYZE_MODEL || 'gpt-5.5';

      this.logger.log(`Gradio /analyze_handler call: provider=${provider}, model=${model}`);

      const result = await client.predict('/analyze_handler', {
        image_np: imageNp,
        image_url: params.imageUrl || '',
        provider,
        model,
      });

      // result.data[0] = suggested prompt (string)
      // result.data[1] = extracted metadata (JSON string)
      const suggestedPrompt = result.data[0] as string;
      const metadataRaw = result.data[1] as string;

      let metadata: Record<string, any>;
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        this.logger.warn(`Failed to parse metadata JSON, using raw string`);
        metadata = { raw: metadataRaw };
      }

      this.logger.log(`Analysis complete: prompt=${suggestedPrompt.slice(0, 80)}...`);

      return { suggested_prompt: suggestedPrompt, metadata };
    } catch (error) {
      this.logger.error(`Analyze reference error: ${error?.message || error}`);
      throw new InternalServerErrorException(
        `Failed to analyze reference image: ${error?.message || 'unknown error'}`,
      );
    }
  }

  /**
   * Match extracted metadata fields to platform style IDs.
   * Returns a map of category → matched style info.
   */
  async matchMetadataToStyles(
    metadata: Record<string, any>,
  ): Promise<Record<string, any>> {
    // Get all active platform styles
    const styles = await this.styleLibrary.findAllActive();

    const matched: Record<string, any> = {};

    // Map metadata field names to style categories
    const fieldToCategoryMap: Record<string, string> = {
      neckline: 'neckline',
      sleeve: 'sleeve',
      sleeve_style: 'sleeve',
      collar: 'collar',
      collar_style: 'collar',
      skirt_style: 'skirt',
      skirt: 'skirt',
      trouser_style: 'trouser',
      trouser: 'trouser',
      silhouette: 'full_body',
      bodice: 'bodice',
      bodice_fit: 'bodice',
      hemline: 'hemline',
      back: 'back',
      back_detail: 'back',
    };

    // Look inside construction sub-object if present, otherwise use top-level
    const construction = metadata.construction || metadata;

    for (const [field, category] of Object.entries(fieldToCategoryMap)) {
      const value = construction[field];
      if (!value || typeof value !== 'string') continue;
      if (matched[category]) continue; // already matched this category

      const valueLower = value.toLowerCase();

      // Find best match: exact name → alias → partial contains
      const match = styles.find((s: any) => {
        if (s.category !== category) return false;
        const nameLower = s.name.toLowerCase();
        // Exact name match
        if (nameLower === valueLower) return true;
        // Alias match
        if (s.aliases?.some((a: string) => a.toLowerCase() === valueLower)) return true;
        // Partial match (either direction)
        if (nameLower.includes(valueLower) || valueLower.includes(nameLower)) return true;
        return false;
      });

      if (match) {
        matched[category] = {
          style_id: (match as any)._id?.toString(),
          style_name: match.name,
          style_code: match.style_code,
          image_url: match.image_url,
          matched_from: value,
        };
      }
    }

    return matched;
  }
}
