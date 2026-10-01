import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QoreIdService } from './qoreid.service';
import { VerificationController } from './verification.controller';
import { QoreIdWebhookController } from './qoreid-webhook.controller';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import { UmsModule } from '../ums/ums.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
    ]),
    UmsModule,
  ],
  controllers: [VerificationController, QoreIdWebhookController],
  providers: [QoreIdService],
  exports: [QoreIdService],
})
export class QoreIdModule {}
