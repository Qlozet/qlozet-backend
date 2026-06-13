import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { MailService } from './mail/mail.service';

@Module({
  imports: [],
  controllers: [NotificationsController],
  providers: [NotificationsService, MailService],
  exports: [MailService],
})
export class NotificationsModule {}
