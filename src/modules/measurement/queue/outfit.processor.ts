import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
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
      case 'editGarment':
        result = await this.measurement.editGarmentWithImageEditor(job.data);
        break;
      case 'generateOutfit':
        result = await this.measurement.generateOutfitImageFromConfig(job.data);
        break;

      case 'videoPipeline':
        const videoMeasurement = await this.measurement.videoPipeline(job.data);
        const videoDataArray = videoMeasurement[4].data;
        result = Object.fromEntries(
          videoDataArray.map(([name, cm, inch]) => [name, { cm, inch }]),
        );
        break;

      case 'autoMask':
        const maskMeasurement = await this.measurement.autoMaskPredict(
          job.data,
        );
        const maskDataArray = maskMeasurement.data;
        result = Object.fromEntries(
          maskDataArray.map(([name, cm, inch]) => [name, { cm, inch }]),
        );
        break;

      case 'avatar':
        result = await this.measurement.generateAvatar(job.data);
        break;

      default:
        const _exhaustiveCheck: never = job.data;
        throw new Error(`Unknown job type: ${(_exhaustiveCheck as any).type}`);
    }

    await this.jobStatusService.updateStatus(jobId, JobState.COMPLETED, result);

    return result;
  }
}
