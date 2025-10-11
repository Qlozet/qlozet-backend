import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';
import { UploadController } from './cloudinary.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  providers: [
    {
      provide: 'CLOUDINARY',
      useFactory: (configService: ConfigService) => {
        return cloudinary.config({
          cloud_name: configService.get('CLOUDINARY_CLOUD_NAME'),
          api_key: configService.get('CLOUDINARY_API_KEY'),
          api_secret: configService.get('CLOUDINARY_API_SECRET'),
        });
      },
      inject: [ConfigService],
    },
    CloudinaryService,
  ],
  exports: [CloudinaryService],
  controllers: [UploadController],
  imports: [AuthModule],
})
export class CloudinaryModule {}
