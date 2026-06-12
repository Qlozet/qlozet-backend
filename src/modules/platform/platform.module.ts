import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformSettings, PlatformSettingsSchema } from './schema/platformSettings.schema';

// Import modules for controller dependencies
import { UmsModule } from '../ums/ums.module';
import { CurrencyModule } from '../currency/currency.module';
import { TicketModule } from '../ticket/ticket.module';
import { BusinessModule } from '../business/business.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformSettings.name, schema: PlatformSettingsSchema },
    ]),
    UmsModule,          // provides UserService (needed by PlatformController)
    CurrencyModule,     // provides CurrencyService (needed by PlatformService)
    TicketModule,       // provides TicketService (needed by PlatformController)
    BusinessModule,     // provides BusinessService (needed by PlatformController)
    forwardRef(() => OrdersModule),  // forwardRef: OrdersModule → PaymentModule → PlatformModule
  ],
  controllers: [PlatformController],
  providers: [PlatformService, JwtService],
  exports: [PlatformService, MongooseModule],
})
export class PlatformModule {}
