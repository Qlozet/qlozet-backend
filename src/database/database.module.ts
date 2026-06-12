import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  exports: [MongooseModule],
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGO_URI'),
        bufferCommands: false,
        serverSelectionTimeoutMS: 30000,
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
