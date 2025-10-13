import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const SetupSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('Qlozet API')
    .setDescription(
      'Comprehensive API documentation for Qlozet — the fashion commerce platform',
    )
    .setVersion('1.0.0')
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Vendors', 'Vendor management endpoints')
    .addTag('Products', 'Product management endpoints')
    .addTag('Customers', 'Customer management endpoints')
    .addTag('Uploads', 'Image upload endpoints (profile & product)')
    .addTag('Discounts', 'Discount management endpoints')
    .addTag('Collections', 'Product collection management endpoints')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Use the access token returned from login or registration',
      },
      'access-token',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Use the refresh token to get a new access token',
      },
      'refresh-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // 🔐 Keeps tokens during refresh
      displayRequestDuration: true, // ⏱️ Shows how long each request takes
    },
    customSiteTitle: 'Qlozet API Documentation',
    customCss: '.topbar { display: none }', // Optional: hide default Swagger banner
  });
};
