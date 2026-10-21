import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MeasurementQuestionsService } from './measurement-questions.service';
import { measurementSnapshot, setMethod } from '../../common/utils/measurement-snapshot';

/**
 * A tailor can ask the customer about the measurements before cutting, and
 * the customer's answer corrects the order's own copy.
 */
describe('measurement questions', () => {
  const vendor = new Types.ObjectId();
  const other = new Types.ObjectId();
  const customer = new Types.ObjectId();
  const itemId = new Types.ObjectId();

  const makeOrder = (over: Record<string, any> = {}) => {
    const order: any = {
      _id: new Types.ObjectId(),
      reference: 'ORD-1',
      customer,
      status: 'processing',
      payment_status: 'paid',
      items: [
        {
          _id: itemId,
          business: vendor,
          body_profile: { set_name: 'Dad', unit: 'cm', measurements: { waist: 40, hip: 104, chest: 100 } },
        },
      ],
      shipments: [{ business: vendor, shipment_type: 'vendor_to_customer', status: 'pending' }],
      customer_body_profile: null,
      measurement_questions: [],
      markModified: jest.fn(),
      save: jest.fn(async () => undefined),
      ...over,
    };
    return order;
  };

  const build = (order: any) => {
    const notices: any[] = [];
    const emails: any[] = [];
    const orderModel: any = {
      findOne: jest.fn(() => {
        const q: any = Promise.resolve(order);
        q.select = () => ({ populate: () => ({ lean: async () => order }) });
        return q;
      }),
      findById: () => ({
        select: () => ({
          populate: () => ({
            populate: () => ({
              lean: async () => ({
                customer: { email: 'ada@example.com', full_name: 'Ada' },
                shipments: [{ business: { _id: vendor, business_name: 'Ade Tailors' } }],
              }),
            }),
          }),
        }),
      }),
    };
    const notifications: any = { create: jest.fn(async (n: any) => notices.push(n)) };
    const recipients: any = { resolve: jest.fn(async () => [{ userId: 'tailor-1' }]) };
    const mail: any = { sendAnnouncementEmail: jest.fn(async (...a: any[]) => emails.push(a)) };
    const service = new MeasurementQuestionsService(orderModel, notifications, recipients, mail);
    return { service, notices, emails };
  };

  it('asks the customer and tells them in-app and by email', async () => {
    const order = makeOrder();
    const { service, notices, emails } = build(order);
    await service.ask('ORD-1', String(vendor), String(new Types.ObjectId()), {
      item_id: String(itemId),
      body_parts: ['waist', 'not_a_part'],
      message: 'Your waist reads 40 cm, could you measure it again?',
    });
    expect(order.measurement_questions).toHaveLength(1);
    expect(order.measurement_questions[0].body_parts).toEqual(['waist']);
    expect(notices[0].type).toBe('measurement_question');
    expect(String(notices[0].recipient)).toBe(String(customer));
    expect(emails[0][0]).toBe('ada@example.com');
  });

  it('refuses a vendor who has no item on the order', async () => {
    const { service } = build(makeOrder());
    await expect(
      service.ask('ORD-1', String(other), 'u', { message: 'Please check your waist measurement.' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses once the piece has shipped', async () => {
    const order = makeOrder({
      shipments: [{ business: vendor, shipment_type: 'vendor_to_customer', status: 'in_transit' }],
    });
    const { service } = build(order);
    await expect(
      service.ask('ORD-1', String(vendor), 'u', { item_id: String(itemId), message: 'Please check your waist measurement.' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("corrects the order's copy with the customer's answer and tells the tailor", async () => {
    const order = makeOrder();
    const { service, notices } = build(order);
    await service.ask('ORD-1', String(vendor), String(new Types.ObjectId()), {
      item_id: String(itemId),
      body_parts: ['waist'],
      message: 'Your waist reads 40 cm, could you measure it again?',
    });
    const qid = String(order.measurement_questions[0]._id);
    const res = await service.answer('ORD-1', String(customer), qid, {
      measurements: { waist: 84 },
      message: 'Typo, sorry!',
    });
    expect(order.items[0].body_profile.measurements.waist).toBe(84);
    expect(order.items[0].body_profile.updated_by_customer_at).toBeInstanceOf(Date);
    expect(res.data.changes).toEqual([{ body_part: 'waist', from: 40, to: 84 }]);
    expect(order.measurement_questions[0].status).toBe('answered');
    expect(notices.some((n) => n.type === 'measurement_answered' && n.recipient === 'tailor-1')).toBe(true);
  });

  it('refuses a second answer, and an empty one', async () => {
    const order = makeOrder();
    const { service } = build(order);
    await service.ask('ORD-1', String(vendor), String(new Types.ObjectId()), {
      item_id: String(itemId),
      message: 'Please check your waist measurement.',
    });
    const qid = String(order.measurement_questions[0]._id);
    await expect(service.answer('ORD-1', String(customer), qid, {})).rejects.toBeInstanceOf(BadRequestException);
    await service.answer('ORD-1', String(customer), qid, { message: 'All correct.' });
    await expect(
      service.answer('ORD-1', String(customer), qid, { message: 'Again' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('snapshot', () => {
    it('records how and when a set was taken', () => {
      const snap = measurementSnapshot(
        { body_type_classification: { bodyType: 'pear' }, body_fit: ['relaxed'] },
        {
          name: 'Me',
          unit: 'cm',
          measurements: new Map([['waist', 80]]),
          method: 'manual',
          updated_at: new Date('2026-10-01'),
          createdAt: new Date('2026-01-01'),
        },
      );
      expect(snap).toMatchObject({
        set_name: 'Me',
        measurements: { waist: 80 },
        method: 'manual',
        body_type: 'pear',
        fit_preferences: ['relaxed'],
      });
      expect(snap!.measured_at).toEqual(new Date('2026-10-01'));
    });

    it('reads an older estimate from what it carries', () => {
      expect(setMethod({ inputs: { weight_kg: 70 } })).toBe('estimate');
      expect(setMethod({})).toBeNull();
    });
  });
});
