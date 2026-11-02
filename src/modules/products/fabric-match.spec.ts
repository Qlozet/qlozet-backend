import { colorDistance, matchFabrics, MIN_MATCH, patternsOf, scoreFabric, typesOf } from './fabric-match';
import { fabricReadingRequest, parseFabricReading, ReadFabric } from '../measurement/fabric-reading';

const royalLace: ReadFabric = {
  role: 'main',
  colors: [{ name: 'royal blue', hex: '#1F3FA8' }],
  fabric_type: 'lace',
  pattern: 'floral',
  description: 'royal blue cord lace',
};
const goldContrast: ReadFabric = {
  role: 'contrast',
  colors: [{ name: 'gold', hex: '#C9A227' }],
  fabric_type: 'silk_satin',
  pattern: 'solid',
  description: 'gold satin trim',
};

const fabric = (id: string, text: string, hex: string[], vendor = 'v1') => ({
  id,
  name: text,
  vendor_id: vendor,
  vendor_name: `Shop ${vendor}`,
  colors: hex.map((h) => ({ hex: h })),
  text,
});

describe('sorting a listing into the reading’s words', () => {
  it('recognises local fabric names and patterns in free text', () => {
    expect([...typesOf('Premium Hollandais wax print')]).toContain('ankara');
    expect([...typesOf('Aso-oke strip weave')]).toContain('aso_oke');
    expect([...typesOf('French cord lace, floral')]).toContain('lace');
    expect([...patternsOf('Floral cord lace')]).toContain('floral');
    expect([...patternsOf('Plain senator material')]).toContain('solid');
  });

  it('measures colour difference: the same blue is near, gold is far', () => {
    expect(colorDistance('#1F3FA8', '#2142AA')!).toBeLessThan(5);
    expect(colorDistance('#1F3FA8', '#C9A227')!).toBeGreaterThan(45);
  });
});

describe('ranking fabrics against a photo', () => {
  it('puts the same colour, type and pattern first, with reasons', () => {
    const near = scoreFabric(royalLace, fabric('a', 'Royal blue floral cord lace', ['#2142AA']));
    const wrongColour = scoreFabric(royalLace, fabric('b', 'Red floral cord lace', ['#B3122E']));
    const wrongType = scoreFabric(royalLace, fabric('c', 'Blue ankara wax print', ['#2142AA']));
    expect(near.score).toBeGreaterThan(wrongType.score);
    expect(wrongType.score).toBeGreaterThan(wrongColour.score);
    expect(near.reasons).toEqual(expect.arrayContaining(['Very close colour', 'Also lace', 'Same floral pattern']));
  });

  it('drops fabrics that are nothing alike', () => {
    const { by_role } = matchFabrics([royalLace], [fabric('x', 'Red ankara geometric', ['#B3122E'])]);
    expect(by_role.main).toHaveLength(0);
    expect(scoreFabric(royalLace, fabric('x', 'Red ankara geometric', ['#B3122E'])).score).toBeLessThan(MIN_MATCH);
  });

  it('offers a set when one shop matches every fabric in the photo', () => {
    const { by_role, sets } = matchFabrics(
      [royalLace, goldContrast],
      [
        fabric('lace1', 'Royal blue floral lace', ['#1F40A6'], 'v1'),
        fabric('satin1', 'Gold satin plain', ['#C8A12A'], 'v1'),
        fabric('lace2', 'Blue floral lace', ['#2A4BB0'], 'v2'),
      ],
    );
    expect(by_role.main[0].fabric_id).toBe('lace1');
    expect(by_role.contrast[0].fabric_id).toBe('satin1');
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ vendor_id: 'v1' });
    expect(sets[0].items.map((i) => i.match.fabric_id)).toEqual(['lace1', 'satin1']);
  });
});

describe('the photo reading', () => {
  it('asks for the fixed reply format with the image by link', () => {
    const body: any = fabricReadingRequest('https://res.cloudinary.com/x/outfit.jpg', 'claude-opus-5-5');
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://res.cloudinary.com/x/outfit.jpg' },
    });
  });

  it('keeps one fabric per role, main first, and drops bad colours', () => {
    const reading = parseFabricReading({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            is_outfit: true,
            fabrics: [
              { role: 'contrast', colors: [{ name: 'gold', hex: '#c9a227' }], fabric_type: 'silk_satin', pattern: 'solid', description: 'trim' },
              { role: 'main', colors: [{ name: 'blue', hex: 'blue' }, { name: 'royal', hex: '#1F3FA8' }], fabric_type: 'velour?', pattern: 'floral', description: 'lace' },
              { role: 'main', colors: [], fabric_type: 'lace', pattern: 'solid', description: 'duplicate' },
            ],
          }),
        },
      ],
    });
    expect(reading!.fabrics.map((f) => f.role)).toEqual(['main', 'contrast']);
    expect(reading!.fabrics[0].colors).toEqual([{ name: 'royal', hex: '#1F3FA8' }]);
    expect(reading!.fabrics[0].fabric_type).toBe('other');
    expect(reading!.fabrics[1].colors[0].hex).toBe('#C9A227');
  });

  it('gives nothing for a refusal or a cut-off reply', () => {
    expect(parseFabricReading({ stop_reason: 'refusal', content: [] })).toBeNull();
    expect(parseFabricReading({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"is_out' }] })).toBeNull();
  });
});
