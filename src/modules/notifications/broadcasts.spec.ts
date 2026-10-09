import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BroadcastsService } from './broadcasts.service';
import {
  BroadcastAudience,
  BroadcastStatus,
} from './schemas/broadcast.schema';
import { NotificationType } from './schemas/notification.schema';

/**
 * Admin announcements.
 *
 * These replaced a settings grid that toggled individual notification types
 * per channel and persisted none of it — while toasting success. The thing
 * actually missing was the opposite of a mute switch: a way to tell an entire
 * audience something.
 */
describe('Admin broadcasts', () => {
  const ADMIN = { id: String(new Types.ObjectId()), name: 'Ada' };

  let broadcastModel: any;
  let notificationModel: any;
  let userModel: any;
  let mail: { sendAnnouncementEmail: jest.Mock };
  let service: BroadcastsService;
  let saved: any;
  let users: any[];

  // A stand-in Mongoose document: save() mutates the same object the test
  // reads, which is what makes the progress counters observable.
  const makeDoc = (fields: any) => {
    const doc = {
      _id: new Types.ObjectId(),
      ...fields,
      save: jest.fn().mockImplementation(() => Promise.resolve(doc)),
    };
    return doc;
  };

  beforeEach(() => {
    users = [
      { _id: new Types.ObjectId(), email: 'a@example.com', full_name: 'Ama' },
      { _id: new Types.ObjectId(), email: 'b@example.com', full_name: 'Bisi' },
      { _id: new Types.ObjectId(), email: null, full_name: 'No Mail' },
    ];

    saved = null;
    broadcastModel = {
      create: jest.fn().mockImplementation(async (fields: any) => {
        saved = makeDoc(fields);
        return saved;
      }),
      findById: jest.fn().mockImplementation(async () => saved),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve([]) }),
        sort: () => ({
          skip: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
        }),
      }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    notificationModel = { insertMany: jest.fn().mockResolvedValue([]) };

    userModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({ lean: () => Promise.resolve(users) }),
      }),
    };

    mail = { sendAnnouncementEmail: jest.fn().mockResolvedValue(true) };

    service = new BroadcastsService(
      broadcastModel,
      notificationModel,
      userModel,
      mail as any,
    );
  });

  describe('composing one', () => {
    const valid = {
      subject: 'Closed for Eid',
      body: '<p>We are closed Monday.</p>',
      audience: BroadcastAudience.CUSTOMERS,
    };

    it('refuses an empty subject or body', async () => {
      await expect(
        service.create({ ...valid, subject: '   ' }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ ...valid, body: '  ' }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an audience that is not one of the three', async () => {
      await expect(
        service.create({ ...valid, audience: 'everyone' as any }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sends now when no time is given', async () => {
      const res = await service.create(valid, ADMIN);

      expect(res.data.status).toBe(BroadcastStatus.SENDING);
      expect(res.data.scheduled_at).toBeNull();
      expect(res.message).toBe('Announcement is being sent');
    });

    it('schedules a future time instead of sending', async () => {
      const when = new Date(Date.now() + 3_600_000).toISOString();
      const res = await service.create({ ...valid, scheduled_at: when }, ADMIN);

      expect(res.data.status).toBe(BroadcastStatus.SCHEDULED);
      expect(res.message).toBe('Announcement scheduled');
      // Nothing may go out yet.
      expect(notificationModel.insertMany).not.toHaveBeenCalled();
    });

    it('treats a time in the past as now rather than an error', async () => {
      // The admin took a minute to finish writing. Rejecting the send over
      // that would be pedantry.
      const res = await service.create(
        { ...valid, scheduled_at: new Date(Date.now() - 60_000).toISOString() },
        ADMIN,
      );
      expect(res.data.status).toBe(BroadcastStatus.SENDING);
    });

    it('rejects a date it cannot parse', async () => {
      await expect(
        service.create({ ...valid, scheduled_at: 'next Tuesday-ish' }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('defaults email on, and takes false seriously', async () => {
      const a = await service.create(valid, ADMIN);
      expect(a.data.send_email).toBe(true);

      const b = await service.create({ ...valid, send_email: false }, ADMIN);
      expect(b.data.send_email).toBe(false);
    });
  });

  describe('sending one', () => {
    // Created as scheduled so create() does not fire the send itself, then
    // dispatched once by hand — otherwise every count here is doubled.
    const start = async (over: any = {}) => {
      await service.create(
        {
          subject: 'Closed for Eid',
          body: '<p>We are <b>closed</b> Monday.</p>',
          audience: BroadcastAudience.CUSTOMERS,
          scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
          ...over,
        },
        ADMIN,
      );
      await service.dispatch(String(saved._id));
    };

    it('resolves the audience to a user type', async () => {
      await start({ audience: BroadcastAudience.VENDORS });
      expect(userModel.find).toHaveBeenCalledWith({ type: 'vendor' });

      userModel.find.mockClear();
      await start({ audience: BroadcastAudience.ADMINS });
      expect(userModel.find).toHaveBeenCalledWith({ type: 'platform' });
    });

    it('writes one bell row per recipient, markup stripped', async () => {
      await start();

      const [rows, opts] = notificationModel.insertMany.mock.calls[0];
      expect(rows).toHaveLength(3);
      expect(rows[0].type).toBe(NotificationType.ANNOUNCEMENT);
      expect(rows[0].title).toBe('Closed for Eid');
      // The bell shows text, not tags.
      expect(rows[0].body).toBe('We are closed Monday.');
      expect(rows[0].metadata.broadcast_id).toBe(String(saved._id));
      // One bad row must not lose the batch.
      expect(opts).toEqual({ ordered: false });
    });

    it('truncates a long message for the bell', async () => {
      await start({ body: `<p>${'x'.repeat(500)}</p>` });
      const [rows] = notificationModel.insertMany.mock.calls[0];
      expect(rows[0].body.length).toBeLessThanOrEqual(303);
      expect(rows[0].body.endsWith('...')).toBe(true);
    });

    it('emails only recipients who have an address', async () => {
      await start();
      // Three users, one without an email.
      expect(mail.sendAnnouncementEmail).toHaveBeenCalledTimes(2);
      expect(saved.emails_sent).toBe(2);
      expect(saved.emails_failed).toBe(0);
    });

    it('still writes bell rows when email is off', async () => {
      await start({ send_email: false });
      expect(notificationModel.insertMany).toHaveBeenCalled();
      expect(mail.sendAnnouncementEmail).not.toHaveBeenCalled();
    });

    it('counts a failed address without abandoning the run', async () => {
      mail.sendAnnouncementEmail
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      await start();

      expect(saved.emails_sent).toBe(1);
      expect(saved.emails_failed).toBe(1);
      expect(saved.status).toBe(BroadcastStatus.SENT);
    });

    it('records the recipient count and finishes as sent', async () => {
      await start();
      expect(saved.recipient_count).toBe(3);
      expect(saved.status).toBe(BroadcastStatus.SENT);
      expect(saved.sent_at).toBeInstanceOf(Date);
    });

    it('marks itself failed instead of throwing', async () => {
      // Nobody awaits dispatch, so an exception would be an unhandled
      // rejection and the record would sit on "sending" forever.
      notificationModel.insertMany.mockRejectedValue(new Error('mongo down'));
      await start();

      expect(broadcastModel.findByIdAndUpdate).toHaveBeenCalledWith(
        String(saved._id),
        expect.objectContaining({ status: BroadcastStatus.FAILED }),
      );
    });

    it('will not send the same broadcast twice', async () => {
      await start();
      notificationModel.insertMany.mockClear();

      await service.dispatch(String(saved._id)); // already SENT
      expect(notificationModel.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('cancelling one', () => {
    it('cancels a scheduled send', async () => {
      await service.create(
        {
          subject: 'S',
          body: 'B',
          audience: BroadcastAudience.CUSTOMERS,
          scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
        ADMIN,
      );

      const res = await service.cancel(String(saved._id));
      expect(res.data.status).toBe(BroadcastStatus.CANCELLED);
    });

    it('refuses once sending has started', async () => {
      await service.create(
        { subject: 'S', body: 'B', audience: BroadcastAudience.CUSTOMERS },
        ADMIN,
      );
      await expect(
        service.cancel(String(saved._id)),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('will not dispatch a cancelled broadcast', async () => {
      await service.create(
        {
          subject: 'S',
          body: 'B',
          audience: BroadcastAudience.CUSTOMERS,
          scheduled_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
        ADMIN,
      );
      await service.cancel(String(saved._id));

      await service.dispatch(String(saved._id));
      expect(notificationModel.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('the scheduled sweep', () => {
    it('only looks for scheduled sends that are due', async () => {
      await service.sendDueBroadcasts();

      const [filter] = broadcastModel.find.mock.calls[0];
      expect(filter.status).toBe(BroadcastStatus.SCHEDULED);
      expect(filter.scheduled_at.$lte).toBeInstanceOf(Date);
      expect(filter.scheduled_at.$ne).toBeNull();
    });

    it('survives a query failure', async () => {
      broadcastModel.find.mockReturnValue({
        select: () => ({ lean: () => Promise.reject(new Error('down')) }),
      });
      await expect(service.sendDueBroadcasts()).resolves.toBeUndefined();
    });
  });
});
