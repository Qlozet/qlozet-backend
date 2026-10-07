import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MailerService } from '@nestjs-modules/mailer';

import { MailService } from './mail.service';
import { EmailLog, EmailStatus } from '../schemas/email-log.schema';

/**
 * Applying ZeptoMail's delivery events to the send log.
 *
 * The matching is a heuristic — recipient plus subject, newest first —
 * because nothing carries our own id end to end over SMTP. These pin the
 * behaviour that heuristic depends on, so a later change to it has to be
 * deliberate rather than accidental.
 */
describe('delivery events', () => {
  let service: MailService;
  let row: any;
  let emailLogModel: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    row = {
      to: 'ada@example.com',
      subject: 'Order QLZ-1 confirmed',
      status: EmailStatus.SENT,
      save: jest.fn().mockResolvedValue(undefined),
    };

    emailLogModel = {
      create: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(row),
        }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: MailerService, useValue: { sendMail: jest.fn() } },
        { provide: getModelToken(EmailLog.name), useValue: emailLogModel },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('moves a sent row to delivered', async () => {
    await service.applyDeliveryEvent({
      to: 'ada@example.com',
      subject: 'Order QLZ-1 confirmed',
      status: EmailStatus.DELIVERED,
    });

    expect(row.status).toBe(EmailStatus.DELIVERED);
    expect(row.status_updated_at).toBeInstanceOf(Date);
    expect(row.save).toHaveBeenCalled();
  });

  it('matches regardless of the casing the provider echoes back', async () => {
    await service.applyDeliveryEvent({
      to: 'Ada@Example.com',
      status: EmailStatus.DELIVERED,
    });

    // Rows are stored lower-cased, so the lookup has to be too.
    expect(emailLogModel.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ada@example.com' }),
    );
  });

  it('takes the newest row when a subject repeats', async () => {
    await service.applyDeliveryEvent({
      to: 'ada@example.com',
      subject: 'Order QLZ-1 confirmed',
      status: EmailStatus.DELIVERED,
    });

    const sort = emailLogModel.findOne.mock.results[0].value.sort;
    expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('stores the provider reference so the two sides can be reconciled', async () => {
    await service.applyDeliveryEvent({
      to: 'ada@example.com',
      status: EmailStatus.HARD_BOUNCE,
      providerReference: '2d6f.41b7d8572391',
    });

    expect(row.provider_reference).toBe('2d6f.41b7d8572391');
  });

  it('keeps the bounce reason on the row', async () => {
    await service.applyDeliveryEvent({
      to: 'ada@example.com',
      status: EmailStatus.HARD_BOUNCE,
      detail: 'Recipient address rejected: user unknown',
    });

    expect(row.error).toContain('user unknown');
  });

  it('does not throw when nothing matches', async () => {
    emailLogModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });

    // A message sent before this table existed, or past the 90-day window,
    // has no row. That is not a fault.
    await expect(
      service.applyDeliveryEvent({
        to: 'nobody@example.com',
        status: EmailStatus.DELIVERED,
      }),
    ).resolves.toBeUndefined();
  });

  it('searches on recipient alone when the event carries no subject', async () => {
    await service.applyDeliveryEvent({
      to: 'ada@example.com',
      status: EmailStatus.SOFT_BOUNCE,
    });

    expect(emailLogModel.findOne).toHaveBeenCalledWith({
      to: 'ada@example.com',
    });
  });
});
