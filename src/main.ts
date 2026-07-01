import { SetupSwagger } from './common/config/swagger.config';
import { CustomResponseInterceptor } from './common/interceptors/response.interceptor';
import { bootstrap } from './bootstrap';

async function startServer() {
  const app = await bootstrap();

  app.useGlobalInterceptors(new CustomResponseInterceptor());

  app.setGlobalPrefix('api');

  SetupSwagger(app);

  const port = Number(process.env.PORT) || 5000;
  const host = '0.0.0.0';

  console.log(`🚀 [BOOT] PORT env = "${process.env.PORT}", resolved port = ${port}, host = ${host}`);

  // Initialize NestJS (DI, modules, etc.) without starting the HTTP listener
  await app.init();

  // Manually bind the underlying HTTP server so we can guarantee the 'listening' event fires
  const httpServer = app.getHttpServer();

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', (err: Error) => {
      console.error(`❌ [BOOT] HTTP server error:`, err);
      reject(err);
    });

    httpServer.listen(port, host, () => {
      const addr = httpServer.address();
      console.log(`✅ [BOOT] HTTP server bound successfully. address =`, JSON.stringify(addr));
      resolve();
    });
  });
}

startServer().catch((err) => {
  console.error('💀 [BOOT] Fatal startup error:', err);
  process.exit(1);
});
