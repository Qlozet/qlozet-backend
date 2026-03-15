import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from './events.service';
import { getModelToken } from '@nestjs/mongoose';
import { Event as EventEntity } from './schemas/event.schema';
import { CreateEventDto } from './dto/create-event.dto';
import { EventType } from './enums/event-type.enum';

const mockEvent = {
    save: jest.fn().mockImplementation(function () { return Promise.resolve(this) }),
};

class MockEventModel {
    constructor(private data: any) {
        Object.assign(this, data);
    }
    save = jest.fn().mockReturnValue(Promise.resolve(this));
    static find = jest.fn().mockReturnThis();
    static sort = jest.fn().mockReturnThis();
    static limit = jest.fn().mockReturnThis();
    static exec = jest.fn().mockResolvedValue([]);
}

describe('EventsService', () => {
    let service: EventsService;
    let model: typeof MockEventModel;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EventsService,
                {
                    provide: getModelToken(EventEntity.name),
                    useValue: MockEventModel,
                },
            ],
        }).compile();

        service = module.get<EventsService>(EventsService);
        model = module.get<any>(getModelToken(EventEntity.name));
    });

    afterEach(() => {
        jest.clearAllMocks();
    })

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should log an event', async () => {
        const dto: CreateEventDto = {
            userId: 'user-1',
            eventType: EventType.VIEW_ITEM,
            properties: { itemId: 'item-1' },
        };
        const result = await service.logEvent(dto);
        expect(result.userId).toEqual(dto.userId);
        expect(result.eventType).toEqual(dto.eventType);
        expect(result.save).toHaveBeenCalled();
    });

    it('should get recent events', async () => {
        const spyFind = jest.spyOn(MockEventModel, 'find');
        await service.getRecentEvents('user-1', 10);
        expect(spyFind).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    });
});
