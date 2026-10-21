import { FabricReservationService } from './fabric-reservation.service';

/**
 * Fabric claimed from a reservation is always delivered. Event pickup was
 * dropped: nothing moved the fabric from the vendor to the organizer, and a
 * "handed over" tap released the vendor's payout with no courier record.
 */
describe('Reservation claims are delivery only', () => {
  const reservation = {
    _id: 'r1',
    status: 'active',
    fee_paid: true,
    deadline: new Date(Date.now() + 5 * 86400000),
    total_yards: 30,
    claimed_yards: 0,
    price_per_yard: 4_000,
    fabric: 'f1',
  };

  const build = () => {
    const service: any = Object.create(FabricReservationService.prototype);
    Object.assign(service, {
      logger: { log: () => undefined, warn: () => undefined, error: () => undefined },
      reservationModel: { findById: async () => reservation },
      productModel: {
        findById: async () => ({ business: 'b1', fabric: { min_cut: 2, yard_length: 100 } }),
      },
      orderService: {
        getCustomerShippingAddress: jest.fn(async () => ({ city: 'Lagos' })),
        buildClaimShipment: jest.fn(async () => {
          // Reaching here proves the claim passed the delivery check; the
          // rest of the flow is not under test.
          throw new Error('stop');
        }),
      },
    });
    return service;
  };

  it('refuses a claim with no address or courier', async () => {
    const service = build();
    await expect(
      service.claimFromReservation('r1', { yards: 4 }, { id: 'g1' }),
    ).rejects.toThrow(/delivery address and courier/);
    expect(service.orderService.buildClaimShipment).not.toHaveBeenCalled();
  });

  it('lets a claim with an address and courier through to delivery', async () => {
    const service = build();
    await expect(
      service.claimFromReservation(
        'r1',
        {
          yards: 4,
          address_id: 'a1',
          courier: { request_token: 't', courier_id: 'c', service_code: 's' },
        },
        { id: 'g1' },
      ),
    ).rejects.toThrow('stop');
    expect(service.orderService.buildClaimShipment).toHaveBeenCalled();
  });
});
