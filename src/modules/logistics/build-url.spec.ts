import { LogisticsService } from './logistics.service';

describe('Shipbubble addresses', () => {
  const urlFor = (base: string) => {
    process.env.SHIPBUBBLE_BASE_URL = base;
    process.env.SHIPBUBBLE_API_KEY = 'k';
    const svc = new LogisticsService({} as any);
    return (svc as any).buildUrl('/shipping/address/validate');
  };

  it('adds /v1 to a host', () => {
    expect(urlFor('https://api.shipbubble.com')).toBe('https://api.shipbubble.com/v1/shipping/address/validate');
  });

  it('never doubles /v1 when the base already has it', () => {
    expect(urlFor('https://api.shipbubble.com/v1')).toBe('https://api.shipbubble.com/v1/shipping/address/validate');
    expect(urlFor('https://api.shipbubble.com/v1/')).toBe('https://api.shipbubble.com/v1/shipping/address/validate');
  });
});
