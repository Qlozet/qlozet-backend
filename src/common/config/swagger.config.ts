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
    .addTag('Users', 'Users management endpoints')
    .addTag('Products', 'Product management endpoints')
    .addTag('Orders', 'Order management endpoints')
    .addTag('Measurements', 'Customer Measurement management endpoints')
    .addTag('Uploads', 'Image upload endpoints (profile & product)')
    .addTag('Discounts', 'Discount management endpoints')
    .addTag('Collections', 'Product collection management endpoints')
    .addTag('Business', 'Business management endpoints')
    .addTag('Transactions', 'Transaction management endpoints')
    .addTag('Wallets', 'Wallets management endpoints')
    .addTag('Tickets', 'Support ticket management endpoints')
    .addTag('Admin', 'Admin management endpoints')
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
