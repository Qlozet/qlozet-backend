import { Module } from '@nestjs/common';
import { SupportController } from './supports.controller';
import { SupportService } from './supports.service';
import { ZohoToken, ZohoTokenSchema } from './schema/zoho-token.schema';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ZohoToken.name, schema: ZohoTokenSchema },
    ]),
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportsModule {}
