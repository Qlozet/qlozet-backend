import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
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
import { SupportsModule } from './modules/supports/supports.module';
import { CartModule } from './modules/cart/cart.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
    SupportsModule,
    CartModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
