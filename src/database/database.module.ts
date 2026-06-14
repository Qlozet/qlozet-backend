import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as mongoose from 'mongoose';

// Set global Mongoose options BEFORE any connection is established
mongoose.set('bufferTimeoutMS', 30000);

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
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
