import {
  arrivalWindow,
  courierTransitDays,
  makingWindow,
} from './delivery-window';

describe('checkout arrival dates', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  const fallback = { min: 2, max: 5 };
  const agbada = { kind: 'clothing', clothing: { type: 'customize', turnaround_days: 14 } };
  const readyToWear = { kind: 'clothing', clothing: { type: 'ready_to_wear', turnaround_days: 2 } };
  const fabric = { kind: 'fabric' };

  it("adds the vendor's making time to the courier's days, so a two-week agbada is not due in three days", () => {
    const making = makingWindow([agbada], 3);
    expect(making).toEqual({ min: 14, max: 14 });
    const transit = courierTransitDays('Within 2 - 3 days', '2026-11-10 18:00:00', now);
    expect(arrivalWindow(making, transit, fallback, now)).toEqual({
      arrives_from: '2026-11-23',
      arrives_to: '2026-11-24',
    });
  });

  it('stock items may ship today or as late as the platform default; the slowest item decides', () => {
    expect(makingWindow([fabric, readyToWear], 3)).toEqual({ min: 0, max: 3 });
    expect(makingWindow([fabric, agbada], 3)).toEqual({ min: 14, max: 14 });
  });

  it("reads the courier's phrase or, failing that, its arrival time", () => {
    expect(courierTransitDays('Within 24 hrs', '', now)).toEqual({ min: 1, max: 1 });
    expect(courierTransitDays('Same day', '', now)).toEqual({ min: 0, max: 0 });
    expect(courierTransitDays('1 - 2 weeks', '', now)).toEqual({ min: 7, max: 14 });
    // The phrase may arrive in either field.
    expect(courierTransitDays('2026-11-10', '3-5 business days', now)).toEqual({ min: 3, max: 5 });
    expect(courierTransitDays('', '2026-11-10 18:00:00', now)).toEqual({ min: 4, max: 4 });
    expect(courierTransitDays('', '', now)).toBeNull();
  });

  it('falls back to the platform transit days when the courier says nothing', () => {
    expect(arrivalWindow({ min: 0, max: 3 }, null, fallback, now)).toEqual({
      arrives_from: '2026-11-09',
      arrives_to: '2026-11-15',
    });
  });
});
