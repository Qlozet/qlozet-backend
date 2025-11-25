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

@Module({
  imports: [
    DatabaseModule,
    WalletsModule,
    BullModule.registerQueue({ name: 'outfit-generation' }),
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
