import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards';
import { join } from 'path';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProductModule } from './modules/products/products.module';
import { UmsModule } from './modules/ums/ums.module';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { BusinessModule } from './modules/business/business.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { CartModule } from './modules/cart/cart.module';
import { OrdersModule } from './modules/orders/orders.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { WalletsModule } from './modules/wallets/wallets.module';
import { MeasurementModule } from './modules/measurement/measurement.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { PlatformModule } from './modules/platform/platform.module';
import { CurrencyModule } from './modules/currency/currency.module';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { WaitlistModule } from './modules/waitlist/waitlist.module';
import { BespokeModule } from './modules/bespoke/bespoke.module';
import { FabricReservationModule } from './modules/fabric-reservation/fabric-reservation.module';
import { StyleLibraryModule } from './modules/style-library/style-library.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL,
        connectTimeout: 30000,
      },
    }),

    ScheduleModule.forRoot({}),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 second
        limit: 3,    // 3 requests per second
      },
      {
        name: 'medium',
        ttl: 10000,  // 10 seconds
        limit: 20,   // 20 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: 60000,  // 1 minute
        limit: 100,  // 100 requests per minute
      },
    ]),
    MailerModule.forRoot({
      transport: {
        host: process.env.MAIL_HOST,
        port: parseInt(process.env.MAIL_PORT || '587'),
        secure: process.env.MAIL_PORT === '465', // true for 465, false for other ports
        auth: {
          user: process.env.MAIL_USERNAME,
          pass: process.env.MAIL_PASSWORD,
        },
      },
      defaults: {
        from: process.env.MAIL_SENDER,
      },
      template: {
        dir: join(process.cwd(), 'src/modules/notifications/mail'),
        adapter: new HandlebarsAdapter(),
        options: {
          partialsDir: join(__dirname, 'templates/partials'),
          strict: true,
        },
      },
    }),
    DatabaseModule,
    AuthModule,
    ProductModule,
    NotificationsModule,
    UmsModule,
    CloudinaryModule,
    BusinessModule,
    TransactionsModule,
    CartModule,
    OrdersModule,
    WebhookModule,
    MeasurementModule,
    WalletsModule,
    LogisticsModule,
    TicketModule,
    PlatformModule,
    RecommendationsModule,
    WaitlistModule,
    BespokeModule,
    FabricReservationModule,
    CurrencyModule,
    StyleLibraryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
