import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import {
  PlatformStyle,
  PlatformStyleSchema,
} from './schemas/platform-style.schema';
import { StyleLibraryService } from './style-library.service';
import { StyleLibraryController } from './style-library.controller';
import { UmsModule } from '../ums/ums.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformStyle.name, schema: PlatformStyleSchema },
    ]),
    UmsModule, // provides User + Role models for RolesGuard
  ],
  controllers: [StyleLibraryController],
  providers: [StyleLibraryService, JwtService],
  exports: [StyleLibraryService],
})
export class StyleLibraryModule {}
