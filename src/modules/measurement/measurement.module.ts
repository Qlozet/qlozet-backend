import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MeasurementService } from './measurement.service';
import { MeasurementController } from './measurement.controller';
import { GradioService } from './gradio.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtService } from '@nestjs/jwt';
import { JobStatus, JobStatusSchema } from 'src/common/schemas/job-status.schema';
import { WalletsModule } from '../wallets/wallets.module';
import { BullModule } from '@nestjs/bullmq';
import { JobStatusService } from './job-status.service';
import { OutfitQueueService } from './outfit-queue.service';
import { OutfitProcessor } from './queue/outfit.processor';
import { UserService } from '../ums/services';
import { UmsModule } from '../ums/ums.module';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: JobStatus.name, schema: JobStatusSchema },
    ]),
    WalletsModule,
    UmsModule,
    PlatformModule,      // provides PlatformService (needed by MeasurementService + controller)
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

