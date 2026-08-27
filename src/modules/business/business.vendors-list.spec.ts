import { BusinessService } from './business.service';
import { BusinessStatus } from './schemas/business.schema';

/**
 * findAllBusinesses() backs the admin console's Vendors page: the table rows,
 * its status filter, and the three stat cards above it.
 *
 * The service constructor pulls in a dozen collaborators none of this touches,
 * so the model is attached to a bare instance.
 */
type Pipeline = Record<string, any>[];

const buildService = (overrides: {
  rows?: unknown[];
  count?: number;
  summary?: Record<string, { n: number }[]>;
} = {}) => {
  const pipelines: Pipeline[] = [];
  const service = Object.create(BusinessService.prototype) as BusinessService;

  Object.assign(service, {
    businessModel: {
      aggregate: jest.fn((pipeline: Pipeline) => {
        pipelines.push(pipeline);
        // The summary roll-up is the one whose $facet has a `total` branch.
        const facet = pipeline.find((stage) => stage.$facet)?.$facet as
          | Record<string, unknown>
          | undefined;
        if (facet && 'total' in facet) {
          return Promise.resolve([overrides.summary ?? {}]);
        }
        return Promise.resolve([
          {
            metadata: [{ total: overrides.count ?? 0 }],
            data: overrides.rows ?? [],
          },
        ]);
      }),
    },
  });

  return {
    service,
    /** The list pipeline (the one that is not the summary). */
    listPipeline: () =>
      pipelines.find(
        (p) => !('total' in ((p.find((s) => s.$facet)?.$facet as object) ?? {})),
      )!,
    summaryPipeline: () =>
      pipelines.find(
        (p) => 'total' in ((p.find((s) => s.$facet)?.$facet as object) ?? {}),
      )!,
  };
};

/** Counts in the shape the summary $facet returns. */
const facet = (counts: Record<string, number>) =>
  Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, [{ n }]]));

describe('BusinessService.findAllBusinesses — status filter', () => {
  const matchOf = (pipeline: Pipeline) =>
    pipeline.find((stage) => stage.$match)?.$match;

  it('does not filter when no status is given', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8);
    expect(matchOf(listPipeline())).toBeUndefined();
  });

  it('maps the console’s three buckets onto sets of statuses', async () => {
    // The console shows three buckets; the collection stores five statuses.
    const active = buildService();
    await active.service.findAllBusinesses(1, 8, 'active');
    expect(matchOf(active.listPipeline()).status.$in).toEqual(
      expect.arrayContaining([BusinessStatus.APPROVED, BusinessStatus.VERIFIED]),
    );

    const inactive = buildService();
    await inactive.service.findAllBusinesses(1, 8, 'inactive');
    expect(matchOf(inactive.listPipeline()).status.$in).toContain(
      BusinessStatus.REJECTED,
    );

    // "Awaiting verification" is everything that is neither, so it is expressed
    // as an exclusion — a new status added later lands here rather than
    // vanishing from every bucket.
    const awaiting = buildService();
    await awaiting.service.findAllBusinesses(1, 8, 'pending');
    const nin = matchOf(awaiting.listPipeline()).status.$nin;
    expect(nin).toEqual(
      expect.arrayContaining([
        BusinessStatus.APPROVED,
        BusinessStatus.VERIFIED,
        BusinessStatus.REJECTED,
      ]),
    );
    expect(nin).not.toContain(BusinessStatus.PENDING);
  });

  it('accepts a raw status so the endpoint stays usable directly', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, 'in-review');
    expect(matchOf(listPipeline())).toEqual({ status: 'in-review' });
  });

  it('ignores an unrecognised filter rather than returning nothing', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, 'not-a-status');
    expect(matchOf(listPipeline())).toBeUndefined();
  });

  it('narrows before the lookups, not after', async () => {
    // Filtering after the product/order joins would join rows about to be
    // discarded.
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, 'active');

    const pipeline = listPipeline();
    const matchAt = pipeline.findIndex((stage) => stage.$match);
    const lookupAt = pipeline.findIndex((stage) => stage.$lookup);
    expect(matchAt).toBe(0);
    expect(matchAt).toBeLessThan(lookupAt);
  });
});

describe('BusinessService.findAllBusinesses — stat-card summary', () => {
  it('counts the buckets the table renders, not is_active', async () => {
    // is_active defaults to true and nothing sets it false, so it would report
    // every vendor active — including the ones the table shows as Inactive.
    const { service, summaryPipeline } = buildService({
      summary: facet({ total: 16, active: 2, inactive: 3 }),
    });

    const result = await service.findAllBusinesses(1, 8);

    expect(result.summary.total_vendors).toBe(16);
    expect(result.summary.active_vendors).toBe(2);
    expect(result.summary.inactive_vendors).toBe(3);
    expect(JSON.stringify(summaryPipeline())).not.toContain('is_active');
  });

  it('accounts for the vendors in neither bucket', async () => {
    // Otherwise 16 total against 2 + 3 shown looks like lost vendors.
    const { service } = buildService({
      summary: facet({ total: 16, active: 2, inactive: 3 }),
    });

    const { summary } = await service.findAllBusinesses(1, 8);
    expect(summary.awaiting_vendors).toBe(11);
  });

  it('reports the 30-day movement for each card', async () => {
    const { service } = buildService({
      summary: facet({
        total: 16,
        active: 2,
        inactive: 3,
        totalCurrent: 5,
        totalPrevious: 4,
        activeCurrent: 3,
        activePrevious: 4,
        inactiveCurrent: 2,
        inactivePrevious: 2,
      }),
    });

    const { summary } = await service.findAllBusinesses(1, 8);

    expect(summary.changes).toEqual({
      period_days: 30,
      total_vendors: 25,
      active_vendors: -25,
      inactive_vendors: 0,
    });
  });

  it('reports null movement rather than +100% off an empty window', async () => {
    const { service } = buildService({
      summary: facet({ total: 1, totalCurrent: 1, totalPrevious: 0 }),
    });

    const { summary } = await service.findAllBusinesses(1, 8);
    expect(summary.changes.total_vendors).toBeNull();
  });

  it('is whole-collection, so the cards do not move as you page or filter', async () => {
    const { service, summaryPipeline } = buildService({
      summary: facet({ total: 16 }),
    });

    await service.findAllBusinesses(2, 8, 'active');

    // No status match and no skip/limit reach the summary roll-up.
    const serialised = JSON.stringify(summaryPipeline());
    expect(serialised).not.toContain('$skip');
    expect(serialised).not.toContain('$limit');
    const facetStage = summaryPipeline().find((s) => s.$facet)!.$facet;
    expect(facetStage.total).toEqual([{ $match: {} }, { $count: 'n' }]);
  });

  it('keeps the paging envelope alongside the summary', async () => {
    const { service } = buildService({
      count: 16,
      rows: [{ _id: 'b1' }],
      summary: facet({ total: 16 }),
    });

    const result = await service.findAllBusinesses(1, 8);

    expect(result.total_items).toBe(16);
    expect(result.data).toHaveLength(1);
    expect(result.summary).toBeDefined();
  });
});

describe('BusinessService.findAllBusinesses — search', () => {
  const searchMatch = (pipeline: Pipeline) =>
    pipeline.find((stage) => stage.$match?.$or)?.$match?.$or;

  it('adds no search stage for a blank term', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, '   ');
    expect(searchMatch(listPipeline())).toBeUndefined();
  });

  it('searches the identity fields the table displays', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, 'flamez');

    const or = searchMatch(listPipeline());
    expect(or.map((clause: Record<string, unknown>) => Object.keys(clause)[0])).toEqual([
      'business_name',
      'business_email',
      // The table falls back to the vendor's own name/email when the business
      // carries neither, so search has to reach them too.
      'vendor.full_name',
      'vendor.email',
    ]);
    expect(or[0].business_name.$options).toBe('i');
  });

  it('escapes the term so punctuation is not read as regex', async () => {
    // An email search like "a+b@x.co" would otherwise be a broken pattern.
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, 'a+b@x.co');

    const or = searchMatch(listPipeline());
    expect(or[0].business_name.$regex).toBe('a\\+b@x\\.co');
  });

  it('searches after the vendor lookup but before the product join', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, 'flamez');

    const pipeline = listPipeline();
    const searchAt = pipeline.findIndex((stage) => stage.$match?.$or);
    const vendorUnwindAt = pipeline.findIndex((stage) => stage.$unwind);
    const productLookupAt = pipeline.findIndex(
      (stage) => stage.$lookup?.from === 'products',
    );

    expect(searchAt).toBeGreaterThan(vendorUnwindAt);
    expect(searchAt).toBeLessThan(productLookupAt);
  });
});

describe('BusinessService.findAllBusinesses — sort', () => {
  const sortOf = (pipeline: Pipeline) =>
    pipeline.find((stage) => stage.$sort)?.$sort;

  it('sorts by revenue in both directions', async () => {
    const desc = buildService();
    await desc.service.findAllBusinesses(1, 8, undefined, undefined, 'revenue', 'desc');
    expect(sortOf(desc.listPipeline()).total_revenue).toBe(-1);

    const asc = buildService();
    await asc.service.findAllBusinesses(1, 8, undefined, undefined, 'revenue', 'asc');
    expect(sortOf(asc.listPipeline()).total_revenue).toBe(1);
  });

  it('defaults to the order the endpoint returned before sorting existed', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8);
    expect(sortOf(listPipeline()).createdAt).toBe(1);
  });

  it('falls back to the default for an unknown column', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, undefined, 'nonsense', 'desc');
    expect(sortOf(listPipeline()).createdAt).toBe(-1);
  });

  it('breaks ties on _id so paging cannot duplicate or skip a row', async () => {
    // Most vendors have revenue 0; without a tiebreak their relative order can
    // differ per page, so one could appear twice and another never.
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, undefined, 'revenue', 'desc');
    expect(sortOf(listPipeline())._id).toBe(1);
  });

  it('sorts the computed columns, which only exist after $addFields', async () => {
    const { service, listPipeline } = buildService();
    await service.findAllBusinesses(1, 8, undefined, undefined, 'revenue', 'desc');

    const pipeline = listPipeline();
    const sortAt = pipeline.findIndex((stage) => stage.$sort);
    const addFieldsAt = pipeline.findIndex((stage) => stage.$addFields);
    const facetAt = pipeline.findIndex((stage) => stage.$facet);

    expect(sortAt).toBeGreaterThan(addFieldsAt);
    // Before $facet, so the sort covers the whole result and not one page.
    expect(sortAt).toBeLessThan(facetAt);
  });
});
