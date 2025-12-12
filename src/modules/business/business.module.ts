import { Module } from '@nestjs/common';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';

import { JwtService } from '@nestjs/jwt';
import { LogisticsService } from '../logistics/logistics.service';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from 'src/database/database.module';
import { ProductModule } from '../products/products.module';
import { BusinessEarningsCron } from './business-earning-cron';

@Module({
  imports: [HttpModule, DatabaseModule, ProductModule],
  controllers: [BusinessController],
  exports: [
    BusinessService,
    JwtService,
    LogisticsService,
    BusinessEarningsCron,
  ],
  providers: [
    BusinessService,
    JwtService,
    LogisticsService,
    BusinessEarningsCron,
  ],
})
export class BusinessModule {}
