import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HelpCenterController } from './help-center.controller';
import { HelpCenterService } from './help-center.service';
import { HelpArticle, HelpArticleSchema } from './schema/help-article.schema';
import {
  PlatformSettings,
  PlatformSettingsSchema,
} from '../platform/schema/platformSettings.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HelpArticle.name, schema: HelpArticleSchema },
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
  ],
  controllers: [HelpCenterController],
  providers: [HelpCenterService],
})
export class HelpCenterModule {}
