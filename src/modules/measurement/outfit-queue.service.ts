import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { VideoPipelineSwaggerDto } from './dto/video-pipeline.dto';
import { AutoMaskSwaggerDto } from './dto/auto-mask-predict.dto';
import { GenerateOutfitRequestDto } from './dto/generate-outfit.dto';
import { JobStatusService } from './job-status.service';
import { createClient } from 'redis';
import { EditGarmentDto } from './dto/edit-image.dto';
import { RunPredictBodyDto } from './dto/run-predict.dto';

@Injectable()
export class OutfitQueueService {
  constructor(
    @InjectQueue('outfit-generation') private queue: Queue,
    private readonly jobService: JobStatusService,
  ) {}

  /** Queue outfit generation */
  async queueEditGarmentGeneration(payload: EditGarmentDto) {
    const jobId = randomUUID();
    await this.queue.add(
      'editGarment',
      {
        type: 'editGarment',
        ...payload,
      },
      {
        jobId,
      },
    );

    // Save job record
    await this.jobService.create(jobId, payload);
    return {
      data: {
        jobId,
        status: 'queued',
      },
      message: 'Generation started. Use the jobId to check the status.',
    };
  }
  async queueRunPrediction(payload: RunPredictBodyDto) {
    const jobId = randomUUID();
    await this.queue.add(
      'runPrediction',
      {
        type: 'runPrediction',
        ...payload,
      },
      {
        jobId,
      },
    );

    // Save job record
    await this.jobService.create(jobId, payload);
    return {
      data: {
        jobId,
        status: 'queued',
      },
      message: 'Prediction started. Use the jobId to check the status.',
    };
  }
  async queueOutfitGeneration(payload: GenerateOutfitRequestDto) {
    const jobId = randomUUID();
    await this.queue.add(
      'generateOutfit',
      {
        type: 'generateOutfit',
        ...payload,
      },
      {
        jobId,
      },
    );

    // Save job record
    await this.jobService.create(jobId, payload);
    return {
      data: {
        jobId,
        status: 'queued',
      },
      message: 'Generation started. Use the jobId to check the status.',
    };
  }

  /** Queue video pipeline job */
  async queueVideoPipeline(payload: VideoPipelineSwaggerDto) {
    await this.clearRedis();
    const jobId = randomUUID();
    await this.queue.add(
      'videoPipeline',
      { type: 'videoPipeline', ...payload },
      { jobId },
    );
    await this.jobService.create(jobId, payload);
    return {
      data: {
        job_id: jobId,
        status: 'queued',
      },
      message: 'Generation started. Use the jobId to check the status.',
    };
  }

  /** Queue auto mask */
  async queueAutoMask(payload: AutoMaskSwaggerDto) {
    const jobId = randomUUID();

    await this.queue.add(
      'autoMask',
      { type: 'autoMask', ...payload },
      { jobId },
    );
    await this.jobService.create(jobId, payload);
    return {
      data: {
        job_id: jobId,
        status: 'queued',
      },
      message: 'Generation started. Use the jobId to check the status.',
    };
  }

  /** Queue avatar job */
  async queueAvatar(payload: any) {
    const jobId = randomUUID();

    await this.queue.add('avatar', { type: 'avatar', ...payload }, { jobId });

    await this.jobService.create(jobId, payload);
    return {
      data: {
        job_id: jobId,
        status: 'queued',
      },
      message: 'Generation started. Use the jobId to check the status.',
    };
  }

  async clearRedis() {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();

    await client.flushAll(); // deletes all keys
    console.log('Redis flushed');

    await client.quit();
  }
}
