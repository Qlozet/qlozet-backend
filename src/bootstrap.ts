import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

export async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Fly terminates TLS and proxies to the app, so without this every request
  // arrives with the proxy's address and ThrottlerGuard's default req.ip
  // tracker collapses all callers into a single bucket — meaning real users
  // rate-limit each other against the 3 req/s 'short' throttler. Trust exactly
  // one hop (Fly's proxy); a larger value or `true` would let a client forge
  // X-Forwarded-For and evade the limit entirely.
  app.set('trust proxy', 1);

  app.enableShutdownHooks();
  app.use(helmet());
  app.use(
    json({
      limit: '50mb',
      // Preserve the exact raw bytes so webhook HMAC signatures
      // (Paystack, Shipbubble) can be verified against the original payload
      // rather than a re-serialized copy.
      verify: (req: any, _res, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  return app;
}
