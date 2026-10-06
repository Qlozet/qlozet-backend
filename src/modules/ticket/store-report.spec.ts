import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { TicketService } from './ticket.service';
import { Ticket } from './schema/ticket.schema';
import { TicketReply } from './schema/reply-ticket.schema';
import { TicketActivity } from './schema/ticket-activity.schema';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Reporting a store files an ordinary ticket, with one difference that has to
 * hold: the reported vendor must never learn who reported them. Everything
 * here is about that boundary, because getting it wrong once is a retaliation
 * risk you cannot take back.
 */
describe('store reports', () => {
  let service: TicketService;
  let ticketModel: any;

  const VENDOR = new Types.ObjectId().toString();
  const CUSTOMER = new Types.ObjectId().toString();

  const chain = (result: unknown) => {
    const c: any = {};
    for (const m of ['populate', 'sort', 'skip', 'limit']) {
      c[m] = jest.fn().mockReturnValue(c);
    }
    c.lean = jest.fn().mockResolvedValue(result);
    return c;
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    ticketModel = {
      create: jest.fn().mockImplementation((doc: any) => ({
        ...doc,
        _id: new Types.ObjectId(),
      })),
      findById: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketService,
        { provide: getModelToken(Ticket.name), useValue: ticketModel },
        {
          provide: getModelToken(TicketReply.name),
          useValue: { find: jest.fn().mockReturnValue(chain([])) },
        },
        {
          provide: getModelToken(TicketActivity.name),
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: jest.fn().mockResolvedValue({}),
            notifyPlatformAdmins: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<TicketService>(TicketService);
  });

  describe('filing one', () => {
    it('attaches the reported vendor and the reporter', async () => {
      await service.createForCustomer(CUSTOMER, {
        issue_type: 'store_report',
        description: 'Listing uses photos from another shop.',
        reported_business: VENDOR,
      } as any);

      const doc = ticketModel.create.mock.calls[0][0];
      expect(String(doc.business)).toBe(VENDOR);
      expect(String(doc.customer)).toBe(CUSTOMER);
    });

    it('leaves an ordinary customer ticket attached to no vendor', async () => {
      await service.createForCustomer(CUSTOMER, {
        issue_type: 'Delivery delay',
        description: 'My order has not arrived.',
      } as any);

      expect(ticketModel.create.mock.calls[0][0].business).toBeNull();
    });

    it('ignores a business a customer tries to set directly', async () => {
      // `business` is not a field on the DTO; a client sending it anyway must
      // not be able to file their ticket as though a vendor raised it.
      await service.createForCustomer(CUSTOMER, {
        issue_type: 'Delivery delay',
        description: 'My order has not arrived.',
        business: VENDOR,
      } as any);

      expect(ticketModel.create.mock.calls[0][0].business).toBeNull();
    });
  });

  describe('what the reported vendor can see', () => {
    it('does not list reports among their own tickets', async () => {
      ticketModel.find.mockReturnValue(chain([]));

      await service.findAll({} as any, 1, 10, new Types.ObjectId(VENDOR));

      const filter = ticketModel.find.mock.calls[0][0];
      expect(String(filter.business)).toBe(VENDOR);
      // The condition that keeps complaints out of the vendor's own list.
      expect(filter.customer).toBeNull();
    });

    it('refuses to open one by id, even though the business matches', async () => {
      ticketModel.findById.mockReturnValue(
        chain({
          _id: new Types.ObjectId(),
          business: { _id: VENDOR },
          customer: { _id: CUSTOMER, full_name: 'Ada', email: 'ada@x.com' },
        }),
      );

      await expect(service.findOne('tid', VENDOR)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('still opens their own ticket, which has no customer', async () => {
      ticketModel.findById.mockReturnValue(
        chain({
          _id: new Types.ObjectId(),
          business: { _id: VENDOR },
          customer: null,
          replies: [],
        }),
      );

      await expect(service.findOne('tid', VENDOR)).resolves.toBeDefined();
    });
  });
});
