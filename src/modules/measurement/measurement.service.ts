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

@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);

  constructor(
    private readonly gradio: GradioService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async runPredict(
    frontFile: Express.Multer.File,
    sideFile: Express.Multer.File,
    body: any,
  ) {
    if (!frontFile) throw new BadRequestException('Front image is required');
    const client = await this.gradio.getClient();

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
  ) {
    if (!front) throw new BadRequestException('Front image is required');
    const client = await this.gradio.getClient();

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
    const client = await this.gradio.getClient();

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

  async videoPipeline(video: Express.Multer.File, body: any) {
    try {
      if (!video) throw new BadRequestException('Video file is required');
      if (!video.buffer)
        throw new BadRequestException('Uploaded file has no buffer');

      this.logger.log('Video upload info:', {
        originalname: video.originalname,
        size: video.size,
        mimetype: video.mimetype,
      });
      const { fileUrl, filePublicId } = await this.cloudinary.uploadFile(
        video,
        'Measurements',
      );

      const client = await this.gradio.getClient();

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
      return {
        success: true,
        data: result.data,
        processingTime: result.time,
      };
    } catch (error) {
      this.logger.error('Video pipeline error:', error);
      throw new InternalServerErrorException(
        `Video processing failed: ${error.message}`,
      );
    }
  }

  private async saveTempVideo(video: Express.Multer.File): Promise<string> {
    try {
      const tempDir = join(process.cwd(), 'temp');

      // Ensure temp directory exists
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      // Get file extension from original name or mimetype
      let extension = '.mp4';
      if (video.originalname) {
        const ext = video.originalname.split('.').pop();
        if (
          ext &&
          ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(
            ext.toLowerCase(),
          )
        ) {
          extension = `.${ext}`;
        }
      }

      const tempFileName = `video-${Date.now()}-${Math.random().toString(36).substring(7)}${extension}`;
      const tempFilePath = join(tempDir, tempFileName);

      writeFileSync(tempFilePath, video.buffer);
      this.logger.log(`Video saved to temporary file: ${tempFilePath}`);

      return tempFilePath;
    } catch (error) {
      this.logger.error('Failed to save temporary video file:', error);
      throw new InternalServerErrorException('Failed to process video file');
    }
  }
  private cleanupTempFile(filePath: string): void {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        this.logger.log(`Temporary file cleaned up: ${filePath}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up temporary file: ${filePath}`, error);
    }
  }
}
