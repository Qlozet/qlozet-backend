import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { MeasurementService } from '../measurement.service';
import { JobStatusService } from '../job-status.service';
import { OutfitJobData } from './outfit-job.interface';
import { JobState } from 'src/common/schemas/job-status.schema';
import { Logger } from '@nestjs/common';

@Processor('outfit-generation')
export class OutfitProcessor extends WorkerHost {
  private readonly logger = new Logger(OutfitProcessor.name);
  constructor(
    private measurement: MeasurementService,
    private jobStatusService: JobStatusService,
  ) {
    super();
  }

  async process(job: Job<OutfitJobData, any, string>): Promise<any> {
    const jobId = String(job.id);
    this.logger.log(`Processing job ${jobId}`);

    await this.jobStatusService.updateStatus(jobId, JobState.RUNNING);

    let result: any;

    switch (job.data.type) {
      case 'generateOutfit':
        result = await this.measurement.generateOutfitImageFromConfig(
          job.data.payload,
        );
        break;

      case 'videoPipeline':
        result = await this.measurement.videoPipeline(
          job.data.files.video,
          job.data.payload,
          job.data.business,
          job.data.customer,
        );
        break;

      case 'autoMask':
        result = await this.measurement.autoMaskPredict(
          job.data.files.bg,
          job.data.files.front,
          job.data.files.side,
          job.data.payload,
          job.data.business,
          job.data.customer,
        );
        break;

      case 'avatar':
        result = await this.measurement.generateAvatar(
          job.data.files.predJson,
          job.data.payload.ui_gender,
        );
        break;

      default:
        const _exhaustiveCheck: never = job.data;
        throw new Error(`Unknown job type: ${(_exhaustiveCheck as any).type}`);
    }

    await this.jobStatusService.updateStatus(jobId, JobState.COMPLETED, result);

    if (job.data.webhook_url) {
      try {
        await axios.post(job.data.webhook_url, {
          jobId,
          status: JobState.COMPLETED,
          data: result,
        });
      } catch (err) {
        this.logger.error(
          `Failed to send webhook for job ${jobId}: ${err.message}`,
        );
      }
    }

    return result;
  }
}
