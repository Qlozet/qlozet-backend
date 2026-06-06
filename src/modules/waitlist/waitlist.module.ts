import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Waitlist, WaitlistSchema } from './schema/waitlist.schema';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Waitlist.name, schema: WaitlistSchema }]),
  ],
  controllers: [WaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
