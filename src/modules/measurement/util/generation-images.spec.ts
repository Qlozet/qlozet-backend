import { orderGenerationImages } from './generation-images';

const REF = 'https://res.cloudinary.com/x/outfits/ref.jpg';
const FABRIC = 'https://res.cloudinary.com/x/products/fabric.webp';
const STRIPES = 'https://res.cloudinary.com/x/products/stripes.jpg';

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

  describe('a two-piece set', () => {
    it('one fabric: both pieces, the pattern at the same scale', () => {
      const r = orderGenerationImages({ referenceUrls: [], metadataRefs: [STRIPES], fabricUrl: STRIPES, bottomPiece: 'trousers' });
      expect(r.note).toContain('make both the top and the trousers from it');
    });

    it('a different bottom fabric goes in as its own labelled picture, never as a style reference', () => {
      const r = orderGenerationImages({
        referenceUrls: [REF, STRIPES],
        metadataRefs: [FABRIC, STRIPES],
        fabricUrl: FABRIC,
        bottomFabricUrl: STRIPES,
        bottomPiece: 'skirt',
      });
      expect(r.urls).toEqual([FABRIC, STRIPES, REF]);
      expect(r.roles.map((x) => x.role)).toEqual(['fabric', 'bottom_fabric', 'style']);
      expect(r.note).toContain("Image 1 is the TOP's fabric");
      expect(r.note).toContain("Image 2 is the SKIRT's fabric");
      expect(r.note).toContain('Keep the two fabrics apart');
      expect(r.note).toContain('Image 3 is a style reference');
    });

    it('only the bottom has a fabric picture (the top is a colour)', () => {
      const r = orderGenerationImages({ referenceUrls: [], metadataRefs: [STRIPES], bottomFabricUrl: STRIPES, bottomPiece: 'trousers' });
      expect(r.urls).toEqual([STRIPES]);
      expect(r.note).toMatch(/^The image is the TROUSERS's fabric/);
      expect(r.note).toContain('Do not use it for the top');
    });
  });
});
