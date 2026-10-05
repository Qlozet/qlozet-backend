import { OrderService } from './orders.service';

/**
 * A vendor who supplies fabric for their own garment.
 *
 * The applied-fabric charge is billed as pricing.external_fabric and kept out
 * of the item's total_price, because on a cross-vendor order it is the other
 * vendor's money. When the fabric is the tailor's own it is theirs — and they
 * are credited for it — but the vendor-scoped order used to return before the
 * fabric view, so the order showed the garment price alone and the earning
 * appeared nowhere. A payout larger than any order explains.
 */
describe('Own fabric on a vendor order', () => {
  const TAILOR = '6aa96c26ef5fdeff8d35d63b';
  const OTHER = '6aa96c26ef5fdeff8d35d999';

  const service: any = Object.create(OrderService.prototype);
  Object.assign(service, {
    computeVendorBreakdown: () => ({
      subtotal: 50000,
      net: 45000,
      commission: 5000,
    }),
  });

  const scope = (fabricOwner: string | null, externalFabric = 10000) =>
    service.scopeOrderForVendor(
      {
        items: [
          {
            business: TAILOR,
            pricing: { external_fabric: externalFabric },
            applied_fabric: fabricOwner ? { business: fabricOwner } : null,
          },
        ],
        shipments: [],
      },
      TAILOR,
      { type: 'percent', percent: 10 },
    );

  it('adds the vendor’s own fabric to their total and earnings', () => {
    const scoped = scope(TAILOR);
    expect(scoped.own_fabric_value).toBe(10000);
    expect(scoped.own_fabric_net).toBe(9000);
    // 50000 garment + 10000 fabric, and the earnings match the two wallet
    // credits the vendor actually received.
    expect(scoped.total).toBe(60000);
    expect(scoped.vendor_earnings).toBe(54000);
    expect(scoped.platform_commission).toBe(6000);
  });

  it('ignores fabric belonging to another vendor', () => {
    // The cross-vendor case must be unchanged: that money is not theirs.
    const scoped = scope(OTHER);
    expect(scoped.own_fabric_value).toBe(0);
    expect(scoped.total).toBe(50000);
    expect(scoped.vendor_earnings).toBe(45000);
  });

  it('is zero when no fabric was applied', () => {
    const scoped = scope(null, 0);
    expect(scoped.own_fabric_value).toBe(0);
    expect(scoped.total).toBe(50000);
  });
});
