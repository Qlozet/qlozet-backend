import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEventDto } from './dto/create-event.dto';
import { EventType } from './enums/event-type.enum';

describe('Events Contract (Dto Validation)', () => {
    it('should validate a valid modern payload with context and metadata', async () => {
        const payload = {
            userId: 'user1',
            eventType: EventType.VIEW_ITEM,
            properties: { itemId: 'item1' },
            context: {
                surface: 'home_feed',
                requestId: 'req-123',
                position: 5,
                stream: 'main'
            },
            metadata: {
                reasonCodes: ['match_tags'],
                dwellMs: 5000
            },
            timestamp: new Date().toISOString()
        };

        const dto = plainToInstance(CreateEventDto, payload);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
    });

    it('should validate a legacy payload (backward compatibility)', async () => {
        const payload = {
            userId: 'user_old',
            eventType: EventType.CLICK_ITEM,
            properties: { itemId: 'item2' }
        };

        const dto = plainToInstance(CreateEventDto, payload);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
    });

    it('should validate new event types', async () => {
        const payload = {
            userId: 'user_batch',
            eventType: EventType.FEED_IMPRESSION_BATCH,
            metadata: {
                seenIds: ['id1', 'id2', 'id3']
            }
        };

        const dto = plainToInstance(CreateEventDto, payload);
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
    });

    it('should fail on invalid context types', async () => {
        const payload = {
            userId: 'user_fail',
            eventType: EventType.VIEW_ITEM,
            context: {
                position: 'not-a-number' // Should fail
            }
        };

        const dto = plainToInstance(CreateEventDto, payload);
        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0].property).toBe('context');
    });
});
