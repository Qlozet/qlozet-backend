import { LegalController } from './legal.controller';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QoreIdService } from './qoreid.service';
import { VerificationController } from './verification.controller';
import { QoreIdWebhookController } from './qoreid-webhook.controller';
import { Business, BusinessSchema } from '../business/schemas/business.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../platform/schema/platformSettings.schema';
import { UmsModule } from '../ums/ums.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      // vendor_verification_mode (manual-verification.ts)
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    UmsModule,
    NotificationsModule, // VendorVerificationNotifier
  ],
  controllers: [VerificationController, QoreIdWebhookController, LegalController],
  providers: [QoreIdService],
  exports: [QoreIdService],
})
export class QoreIdModule {}
