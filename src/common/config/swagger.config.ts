import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SetupSwagger = (app: INestApplication<any>) => {
  const config = new DocumentBuilder()
    .setTitle('Qlozet API')
    .setDescription('This is the API definition for Qlozet')
    .setVersion('1.0')
    .addTag('Products', 'Product management endpoints')
    .addTag('Vendors', 'Vendor management endpoints')
    .addTag('Customers', 'Customer management endpoints')
    .addTag('Auth', 'Authentication endpoints')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'refresh-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document);
};
