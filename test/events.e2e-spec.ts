import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('EventsController (e2e)', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    }, 60000); // Increase timeout for database connection

    afterAll(async () => {
        await app.close();
    });

    it('/recommendations/events (POST)', () => {
        return request(app.getHttpServer())
            .post('/recommendations/events')
            .send({
                userId: 'e2e-user',
                eventType: 'view_item',
                properties: { test: true },
            })
            .expect(201)
            .expect((res) => {
                expect(res.body.userId).toBe('e2e-user');
                expect(res.body.eventType).toBe('view_item');
            });
    });

    it('/recommendations/events (POST) - validation fail', () => {
        return request(app.getHttpServer())
            .post('/recommendations/events')
            .send({
                userId: 'e2e-user',
                // missing eventType
            })
            .expect(400);
    });
});
