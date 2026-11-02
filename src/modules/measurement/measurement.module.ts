import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MeasurementService } from './measurement.service';
import { MeasurementController } from './measurement.controller';
import { GradioService } from './gradio.service';
import { JwtService } from '@nestjs/jwt';
import { JobStatus, JobStatusSchema } from 'src/common/schemas/job-status.schema';
import { WalletsModule } from '../wallets/wallets.module';
import { BullModule } from '@nestjs/bullmq';
import { JobStatusService } from './job-status.service';
import { OutfitQueueService } from './outfit-queue.service';
import { OutfitProcessor } from './queue/outfit.processor';
import { UmsModule } from '../ums/ums.module';
import { PlatformModule } from '../platform/platform.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { StyleLibraryModule } from '../style-library/style-library.module';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { AnthropicAuthService } from '../assistant/llm/anthropic-auth.service';
import { FabricVisionService } from './fabric-vision.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: JobStatus.name, schema: JobStatusSchema },
      // Fabric suggestions from a reference photo rank the fabric listings.
      { name: Product.name, schema: ProductSchema },
    ]),
    WalletsModule,
    UmsModule,
    PlatformModule,       // provides PlatformService
    CloudinaryModule,     // provides CloudinaryService
    StyleLibraryModule,   // provides StyleLibraryService (for style matching)
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
    JwtService,
    JobStatusService,
    OutfitQueueService,
    OutfitProcessor,
    AnthropicAuthService,
    FabricVisionService,
  ],
})
export class MeasurementModule {}

