import { Module } from '@nestjs/common';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';

import { JwtService } from '@nestjs/jwt';
import { LogisticsService } from '../logistics/logistics.service';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from 'src/database/database.module';

@Module({
  imports: [HttpModule, DatabaseModule],
  controllers: [BusinessController],
  exports: [BusinessService, JwtService, LogisticsService],
  providers: [BusinessService, JwtService, LogisticsService],
})
export class BusinessModule {}
