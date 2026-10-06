import { findListingViolations, assertPublishable } from './listing-rules';
import { BadRequestException } from '@nestjs/common';

/**
 * These rules stand between a vendor and their customers, so the cases that
 * matter most are the ones that must NOT fire. A false positive here blocks a
 * legitimate listing and the vendor cannot do anything about it.
 */

const good = {
  title: 'Hand-finished Ankara kaftan',
  description:
    'Cut from heavyweight wax-print cotton and finished with a lined collar. ' +
    'The fit is relaxed through the body with a straight hem. Machine wash ' +
    'cold, hang to dry, warm iron on the reverse.',
  images: [{}, {}, {}],
  variants: [{ stock: 4 }],
};

describe('listing rules', () => {
  it('passes a complete listing', () => {
    expect(findListingViolations(good)).toEqual([]);
  });

  describe('title', () => {
    it('rejects one too short to describe anything', () => {
      expect(findListingViolations({ ...good, title: 'Shirt' })).toContainEqual(
        expect.stringContaining('too short'),
      );
    });

    it('rejects shouting', () => {
      expect(
        findListingViolations({ ...good, title: 'KAFTAN FOR MEN BIG SALE' }),
      ).toContainEqual(expect.stringContaining('normal case'));
    });

    it('allows short all-caps size codes, which are not shouting', () => {
      // "2XL" and "XXL" are upper case because that is how sizes are written.
      expect(
        findListingViolations({ ...good, title: 'Agbada 2XL in navy' }),
      ).toEqual([]);
    });

    it('rejects emoji', () => {
      expect(
        findListingViolations({ ...good, title: 'Ankara kaftan 🔥 brand new' }),
      ).toContainEqual(expect.stringContaining('emoji'));
    });
  });

  describe('description', () => {
    it('rejects a token keystroke', () => {
      expect(
        findListingViolations({ ...good, description: 'Nice kaftan' }),
      ).toContainEqual(expect.stringContaining('at least'));
    });
  });

  describe('contact details', () => {
    const withText = (description: string) => ({ ...good, description });

    it.each([
      ['a Nigerian mobile number', 'Order now, call 0803 123 4567 to confirm.'],
      ['an international number', 'Reach us on +234 803 123 4567 any day.'],
      ['an email address', 'Send your measurements to sales@example.com first.'],
      ['a WhatsApp mention', 'Message us on WhatsApp for a faster reply today.'],
      ['an Instagram handle', 'See more styles on our instagram page daily.'],
      ['an @ handle', 'Follow @kemi_couture for the newest arrivals weekly.'],
      ['an invitation off-platform', 'You can also order directly from us.'],
    ])('catches %s', (_label, text) => {
      const problems = findListingViolations(
        withText(`${good.description} ${text}`),
      );
      expect(problems).toContainEqual(expect.stringContaining('Remove'));
    });

    it('reports contact details once, not once per pattern', () => {
      const problems = findListingViolations(
        withText(
          `${good.description} Call 0803 123 4567 or email us at a@b.com today.`,
        ),
      );
      expect(problems.filter((p) => p.includes('Remove'))).toHaveLength(1);
    });

    it('does not trip on measurements, which are full of digits', () => {
      expect(
        findListingViolations(
          withText(
            'Chest 38 - 40 inches, sleeve 24 inches, length 32 inches. ' +
              'Cut from heavyweight cotton with a lined collar and a straight ' +
              'hem. Machine wash cold, hang to dry, warm iron on the reverse.',
          ),
        ),
      ).toEqual([]);
    });

    it('does not trip on a year or a price in the copy', () => {
      expect(
        findListingViolations(
          withText(
            'A 2024 reissue of our best-selling cut, now 15000 naira. ' +
              'Heavyweight cotton, lined collar, straight hem and a relaxed ' +
              'body. Machine wash cold, hang to dry, warm iron on the reverse.',
          ),
        ),
      ).toEqual([]);
    });

    it('catches a number moved into the title', () => {
      expect(
        findListingViolations({ ...good, title: 'Kaftan call 08031234567' }),
      ).toContainEqual(expect.stringContaining('Remove'));
    });
  });

  describe('gallery and stock', () => {
    it('rejects fewer than three photos', () => {
      expect(findListingViolations({ ...good, images: [{}] })).toContainEqual(
        expect.stringContaining('at least 3 photos'),
      );
    });

    it('rejects a listing whose every size is out of stock', () => {
      expect(
        findListingViolations({ ...good, variants: [{ stock: 0 }, { stock: 0 }] }),
      ).toContainEqual(expect.stringContaining('out of stock'));
    });

    it('ignores stock for kinds that carry no variants', () => {
      // A made-to-order garment has no stocked sizes; absence is not zero.
      expect(findListingViolations({ ...good, variants: [] })).toEqual([]);
    });
  });

  describe('assertPublishable', () => {
    it('says nothing when the listing is fine', () => {
      expect(() => assertPublishable(good)).not.toThrow();
    });

    it('reports every problem in one message, not one per attempt', () => {
      try {
        assertPublishable({ title: 'Hi', description: 'x', images: [] });
        fail('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const { message } = (error as BadRequestException).getResponse() as {
          message: string;
        };
        // A single string, because the response interceptor keeps only the
        // first entry of an array - see assertPublishable.
        expect(typeof message).toBe('string');
        expect(message).toContain('too short');
        expect(message).toContain('150 characters');
        expect(message).toContain('3 photos');
      }
    });
  });
});
