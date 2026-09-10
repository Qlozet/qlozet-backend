import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { MailService } from './mail/mail.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import { User, UserSchema } from '../ums/schemas/user.schema';
import { JwtService } from '@nestjs/jwt';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, MailService, JwtService, NotificationsGateway],
  exports: [NotificationsService, MailService, MongooseModule],
})
export class NotificationsModule {}
