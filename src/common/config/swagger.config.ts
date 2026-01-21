import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ApiBaseResponse } from '../dto/response.decorator';
import { LoginVendorResponseDto } from 'src/modules/auth/dto/login.dto';

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

  const document = SwaggerModule.createDocument(app, config, {
    // extraModels: [ApiBaseResponse, LoginVendorResponseDto],
  });

  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // 🔐 Keeps tokens during refresh
      displayRequestDuration: true, // ⏱️ Shows how long each request takes
    },
    customSiteTitle: 'Qlozet API Documentation',
    customCss: `
  /* Main UI */
  body { background-color: #121212 !important; }
  .swagger-ui .topbar { background-color: #1f1f1f !important; }
  .swagger-ui .info { color: #fff !important; }
  .swagger-ui .opblock { background: #1e1e1e !important; }
  .swagger-ui .opblock-summary { background: #2c2c2c !important; }
  .swagger-ui .opblock-summary-method { filter: brightness(0.9); }
  .swagger-ui * { color: #e7e7e7 !important; }

  /* Authorize modal */
  .swagger-ui .dialog-ux,
  .swagger-ui .modal-ux,
  .swagger-ui .auth-container .wrapper,
  .swagger-ui .auth-btn-wrapper {
    background: #1e1e1e !important;
    color: #ffffff !important;
  }

  .swagger-ui .dialog-ux .modal-ux-inner {
    background: #1e1e1e !important;
    border: 1px solid #333 !important;
    box-shadow: 0 0 10px #000 !important;
  }

  /* Buttons */
  .swagger-ui .btn,
  .swagger-ui .opblock-summary-control {
    background: #4a4a4a !important;
    color: #fff !important;
    border: 1px solid #666 !important;
  }

  .swagger-ui .btn:hover,
  .swagger-ui .opblock-summary-control:hover {
    background: #5a5a5a !important;
  }

  /* Inputs and labels */
  .swagger-ui input,
  .swagger-ui select {
    background: #2e2e2e !important;
    color: #fff !important;
    border: 1px solid #555 !important;
  }

  .swagger-ui label {
    color: #fff !important;
  }

  .swagger-ui .close-modal {
    color: #eee !important;
  }

  /* FIX: Request body textarea (was white) */
  .swagger-ui textarea {
    background: #2e2e2e !important;
    color: #fff !important;
    border: 1px solid #555 !important;
  }

  /* Sometimes body uses a <pre> container */
  .swagger-ui .opblock-body pre {
    background: #2e2e2e !important;
    color: #fff !important;
    border: 1px solid #444 !important;
  }
`,

    // Optional: hide default Swagger banner
  });
};
