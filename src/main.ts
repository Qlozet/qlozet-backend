import { SetupSwagger } from './common/config/swagger.config';
import { CustomResponseInterceptor } from './common/interceptors/response.interceptor';
import { bootstrap } from './bootstrap';

async function startServer() {
  const app = await bootstrap();

  app.useGlobalInterceptors(new CustomResponseInterceptor());

  app.setGlobalPrefix('api');

  SetupSwagger(app);

  await app.listen(Number(process.env.PORT) || 8080, '0.0.0.0');
}

startServer();
