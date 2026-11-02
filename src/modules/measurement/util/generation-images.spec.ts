import { orderGenerationImages } from './generation-images';

const REF = 'https://res.cloudinary.com/x/outfits/ref.jpg';
const FABRIC = 'https://res.cloudinary.com/x/products/fabric.webp';

describe('generation images', () => {
  it('puts the fabric first and tells the model not to take the reference fabric', () => {
    // The shop also sends the fabric among the references; it must appear once.
    const r = orderGenerationImages({ referenceUrls: [REF, FABRIC], metadataRefs: [FABRIC, FABRIC], fabricUrl: FABRIC });
    expect(r.urls).toEqual([FABRIC, REF]);
    expect(r.roles).toEqual([
      { index: 1, role: 'fabric' },
      { index: 2, role: 'style' },
    ]);
    expect(r.note).toContain('Image 1 is the FABRIC');
    expect(r.note).toContain('Image 2 is a style reference');
    expect(r.note).toContain('NOT its fabric');
  });

  it('names a range when there are several style references', () => {
    const r = orderGenerationImages({ referenceUrls: [REF, `${REF}?2`], metadataRefs: [FABRIC], fabricUrl: FABRIC });
    expect(r.note).toContain('Images 2 to 3 are style references');
  });

  it('a fabric alone, references alone, or nothing', () => {
    expect(orderGenerationImages({ referenceUrls: [], metadataRefs: [FABRIC], fabricUrl: FABRIC }).note).toMatch(/^The image is the FABRIC/);
    const refsOnly = orderGenerationImages({ referenceUrls: [REF], metadataRefs: [], fabricUrl: null });
    expect(refsOnly.urls).toEqual([REF]);
    expect(refsOnly.note).toMatch(/^The image is a style reference/);
    expect(orderGenerationImages({ referenceUrls: [], metadataRefs: [] }).note).toBe('');
  });
});
