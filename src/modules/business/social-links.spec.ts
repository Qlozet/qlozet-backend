import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SocialLinksDto, toHandle } from './dto/social-links.dto';

/**
 * Vendors will paste whatever their phone's share sheet gave them. Handles are
 * stored rather than URLs so the link is built by us and always points at the
 * real platform — a stored URL would be an open redirect on a storefront.
 */
describe('Social handles', () => {
  describe('normalising what a vendor pastes', () => {
    const cases: [string, string | undefined][] = [
      ['kemicouture', 'kemicouture'],
      ['@kemicouture', 'kemicouture'],
      ['  @kemicouture  ', 'kemicouture'],
      ['instagram.com/kemicouture', 'kemicouture'],
      ['www.instagram.com/kemicouture', 'kemicouture'],
      ['https://instagram.com/kemicouture', 'kemicouture'],
      ['https://www.instagram.com/kemicouture/', 'kemicouture'],
      // The share sheet's tracking query.
      ['https://www.instagram.com/kemicouture/?igsh=MXY2', 'kemicouture'],
      // TikTok and YouTube keep the @ inside their own URLs.
      ['https://www.tiktok.com/@kemicouture', 'kemicouture'],
      ['https://youtube.com/@kemicouture', 'kemicouture'],
      // X renamed; the handle is the same.
      ['https://x.com/kemicouture', 'kemicouture'],
      // A deep link to a post still identifies the account.
      ['https://instagram.com/kemicouture/reel/C8xYz', 'kemicouture'],
      // Emptying the field clears the link rather than storing ''.
      ['', undefined],
      ['   ', undefined],
    ];

    it.each(cases)('%s → %s', (input, expected) => {
      expect(toHandle(input)).toBe(expected);
    });

    it('ignores a non-string', () => {
      expect(toHandle(42)).toBeUndefined();
      expect(toHandle(null)).toBeUndefined();
    });
  });

  describe('validation', () => {
    const errorsFor = async (value: unknown) => {
      const dto = plainToInstance(SocialLinksDto, { instagram: value });
      const flatten = (errors: any[]): string[] =>
        errors.flatMap((e) => [
          ...Object.values(e.constraints ?? {}).map(String),
          ...flatten(e.children ?? []),
        ]);
      return flatten(await validate(dto));
    };

    it('accepts a handle, however it was pasted', async () => {
      expect(await errorsFor('https://instagram.com/kemi_couture')).toEqual([]);
    });

    it('accepts dots, underscores and hyphens', async () => {
      expect(await errorsFor('kemi.couture_01-ng')).toEqual([]);
    });

    it('rejects a sentence typed into the field', async () => {
      expect((await errorsFor('find me on insta!')).join(' ')).toMatch(
        /must be a handle/i,
      );
    });

    it('rejects a URL on another host, which must not survive as a handle', async () => {
      // An unknown host is not stripped, so the slash fails the pattern
      // rather than being stored as a link we would then render.
      expect((await errorsFor('https://evil.example.com/phish')).join(' ')).toMatch(
        /must be a handle/i,
      );
    });

    it('treats an empty field as cleared, not invalid', async () => {
      expect(await errorsFor('')).toEqual([]);
    });
  });
});
