import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { JwtService } from '@nestjs/jwt';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import { DeviceTokenService } from './device-token.service';
import { PushService } from './push.service';
import { PushController } from './push.controller';
import { PushDispatcher, PushProcessor, PUSH_QUEUE } from './push.queue';
import { firebaseProvider } from './firebase.provider';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Push notifications through Firebase Cloud Messaging (Android directly,
 * iOS via APNs). Hooks onto every saved in-app notification; nothing else in
 * the app talks to Firebase.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: DeviceToken.name, schema: DeviceTokenSchema }]),
    BullModule.registerQueue({ name: PUSH_QUEUE }),
    NotificationsModule, // NotificationsService (badge counts) + the Notification and User models
  ],
  controllers: [PushController],
  // JwtService: the sign-in guard on the token routes resolves here.
  providers: [JwtService, firebaseProvider, DeviceTokenService, PushService, PushDispatcher, PushProcessor],
  exports: [PushService, DeviceTokenService],
})
export class PushModule {}
