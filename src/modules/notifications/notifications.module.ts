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
import { EmailLog, EmailLogSchema } from './schemas/email-log.schema';
import { JwtService } from '@nestjs/jwt';
import { NotificationsGateway } from './notifications.gateway';
import { VendorRecipientsService } from './vendor-recipients.service';
import { TeamMember, TeamMemberSchema } from '../ums/schemas/team.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: EmailLog.name, schema: EmailLogSchema },
      // Read-only, for VendorRecipientsService: who at a business should hear
      // about something. The owner is a TeamMember row like everyone else.
      { name: TeamMember.name, schema: TeamMemberSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    MailService,
    JwtService,
    NotificationsGateway,
    VendorRecipientsService,
  ],
  exports: [
    NotificationsService,
    MailService,
    VendorRecipientsService,
    MongooseModule,
  ],
})
export class NotificationsModule {}
