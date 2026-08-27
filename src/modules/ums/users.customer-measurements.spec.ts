import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserService } from './services/users.service';
import { UserType } from './schemas';

/**
 * getCustomerMeasurements() backs the admin console's Body Measurement panel.
 *
 * Three things matter here. The read must be scoped to the ONE customer and to
 * customers at all — the users collection also holds vendors and staff, and
 * body measurements are about as personal as this data gets. Nothing may be
 * written: the customer-facing getBodyType() caches a fresh classification onto
 * the user, and an admin opening a panel must not mutate the record they are
 * looking at. And the Map that Mongoose stores measurements in has to survive
 * `.lean()` in either of the two shapes it comes back as.
 *
 * The constructor pulls in mail, logistics and size-guide collaborators none of
 * this touches, so the model is attached to a bare instance.
 */

const CUSTOMER = '6a4a085a4ba435c95283926c';

const chain = (result: unknown) => {
  const self: any = {
    select: () => self,
    lean: () => Promise.resolve(result),
  };
  return self;
};

const buildService = (customer: Record<string, unknown> | null) => {
  const filters: Record<string, unknown>[] = [];
  const service = Object.create(UserService.prototype) as UserService;

  const userModel = {
    findOne: jest.fn((filter: Record<string, unknown>) => {
      filters.push(filter);
      return chain(customer);
    }),
    updateOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  Object.assign(service, { userModel });

  return { service, userModel, filters };
};

const SET = {
  name: 'default',
  unit: 'cm',
  active: true,
  createdAt: new Date('2026-08-25T09:12:00.000Z'),
  // Broad shoulders, narrow hips — an inverted triangle / athletic build,
  // whichever family the gender puts it in.
  measurements: { shoulder_breadth: 52, chest: 108, waist: 80, hip: 94 },
};

describe('UserService.getCustomerMeasurements', () => {
  it('reads one customer, and only a customer', async () => {
    const { service, filters } = buildService({
      full_name: 'John Doe',
      gender: 'male',
      measurementSets: [SET],
    });

    await service.getCustomerMeasurements(CUSTOMER);

    expect(filters).toHaveLength(1);
    expect(String((filters[0] as any)._id)).toBe(CUSTOMER);
    expect((filters[0] as any).type).toBe(UserType.CUSTOMER);
  });

  it('404s on a malformed id rather than letting a CastError become a 500', async () => {
    const { service, userModel } = buildService(null);

    await expect(service.getCustomerMeasurements('not-an-id')).rejects.toThrow(
      NotFoundException,
    );
    expect(userModel.findOne).not.toHaveBeenCalled();
  });

  it('404s when the id resolves to nobody', async () => {
    const { service } = buildService(null);

    await expect(service.getCustomerMeasurements(CUSTOMER)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('returns the sets active-first, with the active one called out', async () => {
    const { service } = buildService({
      full_name: 'John Doe',
      gender: 'male',
      measurementSets: [
        { ...SET, name: 'old', active: false },
        { ...SET, name: 'current', active: true },
      ],
    });

    const result = await service.getCustomerMeasurements(CUSTOMER);

    expect(result.sets.map((s) => s.name)).toEqual(['current', 'old']);
    expect(result.active_set?.name).toBe('current');
    expect(result.full_name).toBe('John Doe');
    expect(result.gender).toBe('male');
  });

  it('unwraps measurements whether lean() hands back a Map or a plain object', async () => {
    const asMap = buildService({
      full_name: 'John Doe',
      gender: 'male',
      measurementSets: [
        { ...SET, measurements: new Map(Object.entries(SET.measurements)) },
      ],
    });
    const asObject = buildService({
      full_name: 'John Doe',
      gender: 'male',
      measurementSets: [SET],
    });

    const fromMap = await asMap.service.getCustomerMeasurements(CUSTOMER);
    const fromObject = await asObject.service.getCustomerMeasurements(CUSTOMER);

    expect(fromMap.active_set?.measurements).toEqual(SET.measurements);
    expect(fromObject.active_set?.measurements).toEqual(SET.measurements);
  });

  it('returns the cached classification untouched when there is one', async () => {
    const { service, userModel } = buildService({
      full_name: 'John Doe',
      gender: 'male',
      measurementSets: [SET],
      body_type_classification: {
        bodyType: 'inverted_triangle',
        confidence: 'high',
        flattering_fits: ['tailored'],
        avoid_fits: ['boxy'],
        style_advice: ['Fitted shirts'],
        computed_at: new Date('2026-08-25T09:12:00.000Z'),
        from_set: 'default',
      },
    });

    const result = await service.getCustomerMeasurements(CUSTOMER);

    expect(result.body_type?.type).toBe('inverted_triangle');
    expect(result.body_type?.computed_at).toEqual(
      new Date('2026-08-25T09:12:00.000Z'),
    );
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });

  it('derives an uncached classification without writing it back', async () => {
    const { service, userModel } = buildService({
      full_name: 'John Doe',
      gender: 'male',
      measurementSets: [SET],
    });

    const result = await service.getCustomerMeasurements(CUSTOMER);

    expect(result.body_type).not.toBeNull();
    expect(result.body_type?.type).not.toBe('unclassified');
    // Null says "worked out for this response", not "computed at the epoch".
    expect(result.body_type?.computed_at).toBeNull();
    expect(result.body_type?.from_set).toBe('default');
    expect(userModel.updateOne).not.toHaveBeenCalled();
    expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('has no body type and no active set for a customer who saved none', async () => {
    const { service } = buildService({
      full_name: 'John Doe',
      gender: null,
      measurementSets: [],
    });

    const result = await service.getCustomerMeasurements(CUSTOMER);

    expect(result.sets).toEqual([]);
    expect(result.active_set).toBeNull();
    expect(result.body_type).toBeNull();
  });
});
