import {
  addressForVendor,
  customerForVendor,
  orderContactForVendor,
  shortName,
} from './customer-privacy';

describe('what a vendor sees of a customer', () => {
  it('short names', () => {
    expect(shortName('Ada Obi')).toBe('Ada O.');
    expect(shortName('Ada', 'obi')).toBe('Ada O.');
    expect(shortName('Ada Chioma Obi')).toBe('Ada O.');
    expect(shortName('Ada')).toBe('Ada');
    expect(shortName(undefined, '')).toBe('');
  });

  it('the address is the area only', () => {
    expect(
      addressForVendor({
        full_name: 'Ada Obi',
        phone_number: '+2348031234567',
        address: '12 Admiralty Way',
        city: 'Lekki',
        state: 'Lagos',
        country: 'Nigeria',
        postal_code: '106104',
        address_code: 123,
      }),
    ).toEqual({
      full_name: 'Ada O.',
      city: 'Lekki',
      state: 'Lagos',
      country: 'Nigeria',
    });
  });

  it('the customer loses email and phone', () => {
    const out = customerForVendor({
      _id: 'c1',
      firstName: 'Ada',
      lastName: 'Obi',
      email: 'ada@example.com',
      phone_number: '+2348031234567',
      username: 'ada@example.com',
    });
    expect(out).toEqual({
      _id: 'c1',
      full_name: 'Ada O.',
      firstName: 'Ada',
      lastName: 'O.',
    });
  });

  it('an unpopulated customer id is left alone', () => {
    expect(customerForVendor('c1')).toBe('c1');
  });

  it('applies to an order and keeps everything else', () => {
    const out = orderContactForVendor({
      reference: 'QZ-1',
      total: 5000,
      address: { address: '12 Admiralty Way', city: 'Lekki' },
      customer: { _id: 'c1', full_name: 'Ada Obi', email: 'a@b.c' },
    });
    expect(out.reference).toBe('QZ-1');
    expect(out.total).toBe(5000);
    expect(out.address).toEqual({ city: 'Lekki' });
    expect(out.customer).toEqual({
      _id: 'c1',
      full_name: 'Ada O.',
      firstName: 'Ada',
      lastName: 'O.',
    });
    expect(JSON.stringify(out)).not.toMatch(/Admiralty|a@b\.c/);
  });
});
