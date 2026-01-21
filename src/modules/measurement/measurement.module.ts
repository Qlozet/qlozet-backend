import { Module } from '@nestjs/common';
import { MeasurementService } from './measurement.service';
import { MeasurementController } from './measurement.controller';
import { GradioService } from './gradio.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtService } from '@nestjs/jwt';
import { DatabaseModule } from 'src/database/database.module';
import { WalletsModule } from '../wallets/wallets.module';
import { BullModule } from '@nestjs/bullmq';
import { JobStatusService } from './job-status.service';
import { OutfitQueueService } from './outfit-queue.service';
import { OutfitProcessor } from './queue/outfit.processor';
import { UserService } from '../ums/services';
import { UmsModule } from '../ums/ums.module';

@Module({
  imports: [
    DatabaseModule,
    WalletsModule,
    UmsModule,
    BullModule.registerQueue({
      name: 'outfit-generation',
      defaultJobOptions: {
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
  ],
  controllers: [MeasurementController],
  providers: [
    MeasurementService,
    GradioService,
    CloudinaryService,
    JwtService,
    JobStatusService,
    OutfitQueueService,
    OutfitProcessor,
  ],
})
export class MeasurementModule {}
