import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Waitlist, WaitlistSchema } from './schema/waitlist.schema';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';
import { WaitlistAdminController } from './waitlist-admin.controller';
import { User, UserSchema } from '../ums/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Waitlist.name, schema: WaitlistSchema },
      // Read-only: whether someone on the list has since made an account.
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WaitlistController, WaitlistAdminController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
