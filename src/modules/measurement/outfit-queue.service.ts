import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class OutfitQueueService {
  constructor(@InjectQueue('outfit-generation') private queue: Queue) {}

  async queueGeneration(payload: any): Promise<any> {
    const job = await this.queue.add('generate', {
      type: 'generateOutfit',
      payload,
      webhook_url: payload.webhook_url,
    });

    return job.id;
  }
}
