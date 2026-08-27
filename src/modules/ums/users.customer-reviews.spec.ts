import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserService } from './services/users.service';

/**
 * getCustomerReviews() backs the admin console's Reviews drawer.
 *
 * Ratings are embedded in products, one entry per product per user, so the
 * pipeline is the whole feature and the pipeline is where it can go wrong. Two
 * things are worth pinning down: that the SECOND $match is there (the first
 * selects products this customer rated — without the second, every other
 * reviewer's rating on those products survives the unwind and the customer gets
 * credited with strangers' reviews), and that the summary is computed over
 * their whole history rather than the page, so the distribution bars do not
 * move as the reader pages.
 *
 * The constructor pulls in collaborators none of this touches, so the model is
 * attached to a bare instance.
 */

const CUSTOMER = '6a4a085a4ba435c95283926c';

type Stage = Record<string, any>;

const buildService = (result: unknown) => {
  const pipelines: Stage[][] = [];
  const service = Object.create(UserService.prototype) as UserService;

  Object.assign(service, {
    productModel: {
      aggregate: jest.fn((pipeline: Stage[]) => {
        pipelines.push(pipeline);
        return Promise.resolve(result);
      }),
    },
  });

  return { service, pipelines };
};

const page = (
  reviews: Record<string, unknown>[],
  summary: Record<string, number>[],
) => [{ reviews, summary }];

const review = (patch: Record<string, unknown> = {}) => ({
  product_id: 'p1',
  product_name: 'Maison De Vetements Loafers',
  product_kind: 'clothing',
  product_image: 'https://cdn.example.com/loafers.png',
  vendor_name: 'Maison De Vetements',
  rating: 5,
  comment: 'Fits perfectly.',
  created_at: new Date('2026-08-15T09:31:00.000Z'),
  ...patch,
});

const stageNames = (pipeline: Stage[]) =>
  pipeline.map((stage) => Object.keys(stage)[0]);

describe('UserService.getCustomerReviews', () => {
  it('404s on a malformed id rather than letting a CastError become a 500', async () => {
    const { service, pipelines } = buildService(page([], []));

    await expect(service.getCustomerReviews('not-an-id')).rejects.toThrow(
      NotFoundException,
    );
    expect(pipelines).toHaveLength(0);
  });

  it('keeps only this customer\'s ratings after the unwind', async () => {
    const { service, pipelines } = buildService(page([], []));

    await service.getCustomerReviews(CUSTOMER);

    const [pipeline] = pipelines;
    const names = stageNames(pipeline);
    const unwind = names.indexOf('$unwind');
    const matches = names.reduce<number[]>(
      (acc, name, i) => (name === '$match' ? [...acc, i] : acc),
      [],
    );

    // One before the unwind to select the products, one after to drop everyone
    // else's ratings on them.
    expect(matches).toHaveLength(2);
    expect(matches[0]).toBeLessThan(unwind);
    expect(matches[1]).toBeGreaterThan(unwind);
    matches.forEach((i) => {
      expect(String(pipeline[i].$match['ratings.user'])).toBe(CUSTOMER);
    });
  });

  it('summarises the whole history, not the page', async () => {
    const { service, pipelines } = buildService(page([], []));

    await service.getCustomerReviews(CUSTOMER, 2, 5);

    const facet = pipelines[0].find((stage) => stage.$facet)!.$facet;
    // The page is sliced inside the reviews branch; the summary branch groups
    // everything the pipeline matched.
    expect(stageNames(facet.reviews)).toContain('$skip');
    expect(stageNames(facet.reviews)).toContain('$limit');
    expect(stageNames(facet.summary)).toEqual(['$group']);
  });

  it('pages from 1, and asks for the slice it was asked for', async () => {
    const { service, pipelines } = buildService(page([], []));

    await service.getCustomerReviews(CUSTOMER, 3, 10);

    const facet = pipelines[0].find((stage) => stage.$facet)!.$facet;
    expect(facet.reviews[0].$skip).toBe(20);
    expect(facet.reviews[1].$limit).toBe(10);
  });

  it('sorts by the rating ObjectId for recency, since ratings carry no date', async () => {
    const { service, pipelines } = buildService(page([], []));

    await service.getCustomerReviews(CUSTOMER);

    const sort = pipelines[0].find((stage) => stage.$sort)!.$sort;
    expect(sort).toEqual({ 'ratings._id': -1 });
  });

  it('sorts by star value when asked to', async () => {
    const high = buildService(page([], []));
    const low = buildService(page([], []));

    await high.service.getCustomerReviews(CUSTOMER, 1, 20, 'highest');
    await low.service.getCustomerReviews(CUSTOMER, 1, 20, 'lowest');

    expect(high.pipelines[0].find((s) => s.$sort)!.$sort).toEqual({
      'ratings.value': -1,
    });
    expect(low.pipelines[0].find((s) => s.$sort)!.$sort).toEqual({
      'ratings.value': 1,
    });
  });

  it('returns the rows and the distribution the pipeline produced', async () => {
    const { service } = buildService(
      page([review(), review({ rating: 4, comment: null })], [
        {
          total_reviews: 2,
          average_rating: 4.5,
          five_star: 1,
          four_star: 1,
          three_star: 0,
          two_star: 0,
          one_star: 0,
        },
      ]),
    );

    const result = await service.getCustomerReviews(CUSTOMER);

    expect(result.reviews).toHaveLength(2);
    expect(result.summary.average_rating).toBe(4.5);
    expect(result.summary.five_star).toBe(1);
    expect(result.pagination).toEqual({
      page: 1,
      size: 20,
      total: 2,
      pages: 1,
    });
  });

  it('rounds the average to one decimal', async () => {
    const { service } = buildService(
      page([], [{ total_reviews: 3, average_rating: 4.666666 }]),
    );

    const result = await service.getCustomerReviews(CUSTOMER);

    expect(result.summary.average_rating).toBe(4.7);
  });

  it('reads as zeroes, not nulls, for a customer who wrote none', async () => {
    const { service } = buildService(page([], []));

    const result = await service.getCustomerReviews(CUSTOMER);

    expect(result.reviews).toEqual([]);
    expect(result.summary).toEqual({
      total_reviews: 0,
      average_rating: 0,
      five_star: 0,
      four_star: 0,
      three_star: 0,
      two_star: 0,
      one_star: 0,
    });
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.pages).toBe(0);
  });

  it('clamps a nonsense page or size rather than skipping backwards', async () => {
    const { service, pipelines } = buildService(page([], []));

    await service.getCustomerReviews(CUSTOMER, 0, 5000);

    const facet = pipelines[0].find((stage) => stage.$facet)!.$facet;
    expect(facet.reviews[0].$skip).toBe(0);
    expect(facet.reviews[1].$limit).toBe(100);
  });
});
