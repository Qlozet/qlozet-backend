import seedData = require('./data/seed-styles.json');
import {
  StyleCategory,
  StyleGender,
  StyleType,
} from './schemas/platform-style.schema';
import { StyleLibraryService } from './style-library.service';

// The shop studio lists full-body styles per garment by NAME
// (qlozet-shop src/data/studio-options.ts fullBodyStylesFor). Kept in step
// here so a starter style can't land under the wrong garment.
const NOT_A_DRESS =
  /jumpsuit|playsuit|romper|\bsets?\b|buba|\biro\b|dashiki|agbada|senator|safari/i;
const KAFTAN = /kaftan|caftan|senator|safari|dashiki/i;
const JUMPSUIT = /jumpsuit|playsuit|romper/i;

const TYPE_FOR: Record<string, string> = {
  neckline: 'top',
  sleeve: 'top',
  collar: 'top',
  bodice: 'top',
  skirt: 'bottom',
  trouser: 'bottom',
  hemline: 'bottom',
  full_body: 'full_body',
};

const styles = seedData as any[];

describe('starter platform styles', () => {
  it('has unique codes and names', () => {
    const codes = styles.map((s) => s.style_code);
    const names = styles.map((s) => s.name.toLowerCase());
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses only allowed values, with the type matching the category', () => {
    const cats = Object.values(StyleCategory) as string[];
    const types = Object.values(StyleType) as string[];
    const genders = Object.values(StyleGender) as string[];
    for (const s of styles) {
      expect(cats).toContain(s.category);
      expect(types).toContain(s.type);
      expect(genders).toContain(s.gender);
      expect(TYPE_FOR[s.category]).toBe(s.type);
      expect(s.description?.length).toBeGreaterThan(20);
      expect(Array.isArray(s.aliases)).toBe(true);
      expect(Array.isArray(s.attributes)).toBe(true);
    }
  });

  it('names men’s full-body styles so the shop files them under a garment', () => {
    for (const s of styles.filter(
      (x) => x.category === 'full_body' && x.gender === 'male',
    )) {
      expect(/agbada/i.test(s.name) || KAFTAN.test(s.name)).toBe(true);
    }
  });

  it('every new jumpsuit is named so, and dresses never match a non-dress word', () => {
    for (const s of styles.filter(
      (x) => x.category === 'full_body' && x.gender === 'female',
    )) {
      if (/^FB_(JUMPSUIT|PLAYSUIT)/.test(s.style_code))
        expect(JUMPSUIT.test(s.name)).toBe(true);
      if (/^FB_DRESS_/.test(s.style_code))
        expect(NOT_A_DRESS.test(s.name)).toBe(false);
    }
  });

  it('covers the men’s and women’s gaps it was written for', () => {
    const count = (fn: (s: any) => boolean) => styles.filter(fn).length;
    expect(
      count((s) => s.category === 'full_body' && /agbada/i.test(s.name)),
    ).toBeGreaterThanOrEqual(5);
    expect(
      count((s) => s.category === 'collar' && s.gender === 'male'),
    ).toBeGreaterThanOrEqual(5);
    expect(
      count((s) => s.style_code.startsWith('FB_DRESS_')),
    ).toBeGreaterThanOrEqual(10);
  });
});

describe('StyleLibraryService.seed', () => {
  const build = (existingCodes: string[]) => {
    const inserted: any[] = [];
    const styleModel = {
      find: jest.fn(() => ({
        select: () => ({
          lean: async () => existingCodes.map((style_code) => ({ style_code })),
        }),
      })),
      insertMany: jest.fn(async (docs: any[]) => {
        inserted.push(...docs);
        return docs;
      }),
    };
    const service = new StyleLibraryService(
      styleModel as any,
      {} as any,
      {} as any,
      { get: () => undefined } as any,
    );
    const drawn = jest
      .spyOn(service as any, 'processImageGeneration')
      .mockResolvedValue(undefined);
    return { service, styleModel, inserted, drawn };
  };

  it('adds only the platform styles that are missing, and draws them in the background', async () => {
    const already = styles.slice(0, 50).map((s) => s.style_code);
    const { service, styleModel, inserted, drawn } = build(already);
    const res = await service.seed();
    expect(styleModel.find).toHaveBeenCalledWith({ business: null });
    expect(res).toEqual({
      created: styles.length - 50,
      skipped: 50,
      images_pending: styles.length - 50,
    });
    expect(inserted.every((d) => d.business === null && d.is_active)).toBe(
      true,
    );
    expect(inserted.map((d) => d.style_code)).not.toContain(already[0]);
    expect(drawn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when every starter style is there', async () => {
    const { service, styleModel, drawn } = build(
      styles.map((s) => s.style_code),
    );
    expect(await service.seed()).toEqual({
      created: 0,
      skipped: styles.length,
      images_pending: 0,
    });
    expect(styleModel.insertMany).not.toHaveBeenCalled();
    expect(drawn).not.toHaveBeenCalled();
  });
});
