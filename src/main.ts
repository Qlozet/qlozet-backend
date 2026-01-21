import { SetupSwagger } from './common/config/swagger.config';
import { CustomResponseInterceptor } from './common/interceptors/response.interceptor';
import { bootstrap } from './bootstrap';

async function startServer() {
  const app = await bootstrap();

  app.useGlobalInterceptors(new CustomResponseInterceptor());

  app.setGlobalPrefix('api');

  SetupSwagger(app);

  await app.listen(process.env.PORT ?? 5000, '0.0.0.0');
}

startServer();
