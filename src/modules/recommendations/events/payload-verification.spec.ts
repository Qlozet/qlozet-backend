import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEventDto } from './dto/create-event.dto';
import * as fs from 'fs';
import * as path from 'path';

describe('Event Payloads JSON Verification', () => {
    const payloadsPath = path.join(__dirname, 'examples', 'event-payloads.json');
    const fileContent = fs.readFileSync(payloadsPath, 'utf-8');
    const examples = JSON.parse(fileContent);

    examples.forEach((example) => {
        it(`should validate ${example.description} payload`, async () => {
            const dto = plainToInstance(CreateEventDto, example.payload);
            const errors = await validate(dto);

            if (errors.length > 0) {
                console.error(`Validation failed for ${example.description}:`, JSON.stringify(errors, null, 2));
            }
            expect(errors.length).toBe(0);
        });
    });
});
