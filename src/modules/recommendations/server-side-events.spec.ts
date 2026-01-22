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

    const mockCart = {
        items: [],
        save: jest.fn().mockResolvedValue({}),
    };

    const mockUser = {
        _id: '507f1f77bcf86cd799439011', // valid ObjectId
        wishlist: [],
        save: jest.fn().mockResolvedValue({}),
    };

    beforeEach(async () => {
        // Reset mocks with proper chaining
        mockModel.findOne.mockReturnValue({
            populate: jest.fn().mockResolvedValue(mockCart),
        });

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                CartService,
                UserService,
                { provide: EventsService, useValue: mockEventsService },
                { provide: getModelToken(Cart.name), useValue: mockModel },
                { provide: getModelToken(Product.name), useValue: { ...mockModel, findById: jest.fn().mockResolvedValue({ _id: '507f1f77bcf86cd799439012', base_price: 100 }) } },
                {
                    provide: getModelToken(User.name), useValue: {
                        ...mockModel,
                        findById: jest.fn().mockReturnValue({
                            populate: jest.fn().mockResolvedValue(mockUser)
                        })
                    }
                },
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
            await cartService.addItem('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012', 1);

            expect(mockEventsService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                userId: '507f1f77bcf86cd799439011',
                eventType: EventType.ADD_TO_CART,
                context: { surface: 'server_hook' }
            }));
        });

        it('should log REMOVE_FROM_CART event on removeItem', async () => {
            await cartService.removeItem('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');

            expect(mockEventsService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                userId: '507f1f77bcf86cd799439011',
                eventType: EventType.REMOVE_FROM_CART,
                context: { surface: 'server_hook' }
            }));
        });
    });

    describe('User Hooks', () => {
        it('should log WISHLIST_ADD on addToWishlist', async () => {
            await userService.addToWishlist('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012');

            expect(mockEventsService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
                userId: '507f1f77bcf86cd799439011',
                eventType: EventType.WISHLIST_ADD,
                context: { surface: 'server_hook' }
            }));
        });
    });
});
