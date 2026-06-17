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
    this.logger.log(`Processing job ${jobId} (type: ${job.data.type})`);

    await this.jobStatusService.updateStatus(jobId, JobState.RUNNING);

    try {
      let result: any;

      switch (job.data.type) {
        case 'runPrediction': {
          // runPrediction returns result.data[0] which is the raw prediction data
          const prediction = await this.measurement.runPrediction(job.data);
          // prediction is already the inner data (array of [name, cm, inch])
          const dataArray = Array.isArray(prediction?.data)
            ? prediction.data
            : Array.isArray(prediction)
              ? prediction
              : [];

          if (dataArray.length === 0) {
            this.logger.warn(
              `runPrediction returned unexpected shape: ${JSON.stringify(prediction)?.slice(0, 200)}`,
            );
          }

          result = Object.fromEntries(
            dataArray.map(([name, cm, inch]) => [name, { cm, inch }]),
          );
          break;
        }

        case 'editGarment':
          result = await this.measurement.editGarmentWithImageEditor(job.data);
          break;

        case 'generateOutfit':
          result = await this.measurement.generateOutfitImageFromConfig(
            job.data,
          );
          break;

        case 'videoPipeline': {
          const videoMeasurement = await this.measurement.videoPipeline(
            job.data,
          );
          const videoDataArray = videoMeasurement[4].data;

          result = Object.fromEntries(
            videoDataArray.map(([name, cm, inch]) => [name, { cm, inch }]),
          );
          break;
        }

        case 'autoMask': {
          const maskMeasurement = await this.measurement.autoMaskPredict(
            job.data,
          );
          const maskDataArray = maskMeasurement.data;

          result = Object.fromEntries(
            maskDataArray.map(([name, cm, inch]) => [name, { cm, inch }]),
          );
          break;
        }

        case 'avatar':
          result = await this.measurement.generateAvatar(job.data);
          break;

        case 'analyzeReference': {
          const analysis = await this.measurement.analyzeReferenceImage(job.data);
          // Also match metadata to platform styles
          const matchedStyles = await this.measurement.matchMetadataToStyles(
            analysis.metadata,
          );
          result = {
            ...analysis,
            matched_styles: matchedStyles,
          };
          break;
        }

        default: {
          throw new Error(`Unknown job type: ${(job.data as any).type}`);
        }
      }

      // Retry wrapper: Fly.io proxy may kill idle TCP connections during
      // long Gradio calls, causing the first MongoDB write to fail.
      await this.retryMongo(() =>
        this.jobStatusService.updateStatus(jobId, JobState.COMPLETED, result),
      );
      this.logger.log(`Job ${jobId} completed successfully`);

      return result;
    } catch (error) {
      this.logger.error(
        `Job ${jobId} failed: ${error?.message || error}`,
        error?.stack,
      );

      await this.retryMongo(() =>
        this.jobStatusService.updateStatus(
          jobId,
          JobState.FAILED,
          null,
          error?.message || 'Unknown error',
        ),
      ).catch((e) =>
        this.logger.error(
          `Failed to update job status to FAILED: ${e.message}`,
        ),
      );

      throw error;
    }
  }

  /**
   * Retry a MongoDB operation up to 3 times with a short delay.
   * Handles stale connections from Fly.io proxy killing idle sockets.
   */
  private async retryMongo<T>(
    fn: () => Promise<T>,
    retries = 3,
    delayMs = 2000,
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        const isConnectionError =
          err?.message?.includes('buffering timed out') ||
          err?.message?.includes('connection') ||
          err?.message?.includes('topology');
        if (isConnectionError && i < retries - 1) {
          this.logger.warn(
            `MongoDB retry ${i + 1}/${retries}: ${err.message}`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw new Error('retryMongo exhausted');
  }
}
