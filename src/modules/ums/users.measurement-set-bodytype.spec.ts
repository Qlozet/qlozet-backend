import { UserService } from './services/users.service';

/**
 * The cached body type is what Ask and the tailor read. It is computed from
 * the default measurement set, so every way the default can change has to
 * refresh it: activating another set, deleting the active one, changing
 * gender. Before, only create and update did.
 */

const ATHLETIC = { chest: 108, waist: 80, hip: 94, shoulder_breadth: 48 };
const ROUND = { chest: 110, waist: 108, hip: 104, shoulder_breadth: 46 };

const asMap = (m: Record<string, number>) => new Map(Object.entries(m));

const makeUser = (
  sets: { name: string; active: boolean; measurements: Record<string, number> }[],
  cached?: any,
) => {
  const user: any = {
    _id: 'u1',
    gender: 'male',
    measurementSets: sets.map((s) => ({ ...s, unit: 'cm', measurements: asMap(s.measurements) })),
    body_type_classification: cached ?? null,
    save: jest.fn().mockResolvedValue(undefined),
    markModified: jest.fn(),
  };
  return user;
};

const buildService = (user: any) => {
  const service = Object.create(UserService.prototype) as any;
  const userModel = {
    findById: jest.fn(() => {
      const chain: any = {
        select: () => chain,
        lean: () => Promise.resolve(user),
        then: (resolve: any, reject: any) => Promise.resolve(user).then(resolve, reject),
      };
      return chain;
    }),
    updateOne: jest.fn().mockResolvedValue(undefined),
  };
  Object.assign(service, {
    userModel,
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    recomputeFittingProducts: jest.fn().mockResolvedValue(undefined),
  });
  return { service: service as UserService, userModel };
};

const cachedFrom = (name: string, bodyType = 'athletic') => ({
  bodyType,
  confidence: 'high',
  flattering_fits: [],
  avoid_fits: [],
  style_advice: [],
  computed_at: new Date('2026-08-01T00:00:00.000Z'),
  from_set: name,
  classifier_version: 2,
});

describe('body type follows the default measurement set', () => {
  it('activating another set reclassifies from that set', async () => {
    const user = makeUser(
      [
        { name: 'me', active: true, measurements: ATHLETIC },
        { name: 'dad', active: false, measurements: ROUND },
      ],
      cachedFrom('me'),
    );
    const { service } = buildService(user);

    await service.setActiveMeasurementSet('u1', 'dad');

    expect(user.body_type_classification.bodyType).toBe('round');
    expect(user.body_type_classification.from_set).toBe('dad');
    expect(user.save).toHaveBeenCalled();
  });

  it('deleting the active set classifies the set that takes over', async () => {
    const user = makeUser(
      [
        { name: 'me', active: true, measurements: ATHLETIC },
        { name: 'dad', active: false, measurements: ROUND },
      ],
      cachedFrom('me'),
    );
    const { service } = buildService(user);

    await service.deleteMeasurementSet('u1', 'me');

    expect(user.measurementSets[0].active).toBe(true);
    expect(user.body_type_classification.bodyType).toBe('round');
    expect(user.body_type_classification.from_set).toBe('dad');
  });

  it('deleting the only set leaves no body type behind', async () => {
    const user = makeUser([{ name: 'me', active: true, measurements: ATHLETIC }], cachedFrom('me'));
    const { service } = buildService(user);

    await service.deleteMeasurementSet('u1', 'me');

    expect(user.measurementSets).toHaveLength(0);
    expect(user.body_type_classification).toBeNull();
  });

  it('getBodyType recomputes a cache that belongs to a set no longer active', async () => {
    const user = makeUser(
      [
        { name: 'me', active: false, measurements: ATHLETIC },
        { name: 'dad', active: true, measurements: ROUND },
      ],
      cachedFrom('me'),
    );
    const { service, userModel } = buildService(user);

    const result: any = await service.getBodyType('u1');

    expect(result.bodyType).toBe('round');
    expect(result.from_set).toBe('dad');
    expect(userModel.updateOne).toHaveBeenCalled();
  });

  it('getBodyType trusts a cache that is about the active set', async () => {
    const user = makeUser([{ name: 'me', active: true, measurements: ATHLETIC }], cachedFrom('me'));
    const { service, userModel } = buildService(user);

    const result: any = await service.getBodyType('u1');

    expect(result.bodyType).toBe('athletic');
    expect(userModel.updateOne).not.toHaveBeenCalled();
  });
});
