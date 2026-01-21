import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { IntegrityService } from '../modules/recommendations/integrity/integrity.service';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const integrityService = app.get(IntegrityService);

    console.log('Running Manual Integrity Check...');
    const report = await integrityService.generateIntegrityReport();
    console.log(JSON.stringify(report, null, 2));

    await app.close();
}

bootstrap();
