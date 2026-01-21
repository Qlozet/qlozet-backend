import { Test, TestingModule } from '@nestjs/testing';
import { CartService } from '../cart/cart.service';
import { UserService } from '../ums/services/users.service';
import { EventsService } from './events/events.service';
import { EventType } from './events/enums/event-type.enum';
import { getModelToken } from '@nestjs/mongoose';
import { Cart } from '../cart/schema/cart.schema';
import { Product } from '../products/schemas';
import { User } from '../ums/schemas';
import { Address } from '../ums/schemas/address.schema';
import { MailService } from '../notifications/mail/mail.service';
import { LogisticsService } from '../logistics/logistics.service';

describe('Server-Side Event Hooks', () => {
    let cartService: CartService;
    let userService: UserService;
    let eventsService: EventsService;

    const mockEventsService = {
        logEvent: jest.fn().mockResolvedValue({}),
    };

    const mockModel = {
        findOne: jest.fn(),
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CartService,
                UserService,
                { provide: EventsService, useValue: mockEventsService },
                { provide: getModelToken(Cart.name), useValue: mockModel },
                { provide: getModelToken(Product.name), useValue: { ...mockModel, findById: jest.fn().mockResolvedValue({ _id: 'pid', base_price: 100 }) } },
                { provide: getModelToken(User.name), useValue: { ...mockModel, findById: jest.fn().mockResolvedValue({ _id: 'uid', wishlist: [] }) } },
                { provide: getModelToken(Address.name), useValue: mockModel },
                { provide: MailService, useValue: {} },
                { provide: LogisticsService, useValue: {} },
            ],
        }).compile();

        cartService = module.get<CartService>(CartService);
        userService = module.get<UserService>(UserService);
        eventsService = module.get<EventsService>(EventsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Cart Hooks', () => {
        it('should log ADD_TO_CART event on addItem', async () => {
            mockModel.findOne.mockReturnValue({ populate: () => ({ items: [], save: jest.fn() }) });

            await cartService.addItem('uid', 'pid', 1);

            expect(mockEventsService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'uid',
                eventType: EventType.ADD_TO_CART,
                context: { surface: 'server_hook' }
            }));
        });

        it('should log REMOVE_FROM_CART event on removeItem', async () => {
            mockModel.findOne.mockReturnValue({ populate: () => ({ items: [], save: jest.fn() }) });
            await cartService.removeItem('uid', 'pid');

            expect(mockEventsService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'uid',
                eventType: EventType.REMOVE_FROM_CART,
                context: { surface: 'server_hook' }
            }));
        });
    });

    describe('User Hooks', () => {
        it('should log WISHLIST_ADD on addToWishlist', async () => {
            await userService.addToWishlist('uid', 'pid');

            expect(mockEventsService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                userId: 'uid',
                eventType: EventType.WISHLIST_ADD,
                context: { surface: 'server_hook' }
            }));
        });
    });
});
