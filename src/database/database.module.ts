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
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 2,
        heartbeatFrequencyMS: 5000,
        maxIdleTimeMS: 60000,
        bufferTimeoutMS: 30000,           // wait up to 30s for stale connections to recover
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
