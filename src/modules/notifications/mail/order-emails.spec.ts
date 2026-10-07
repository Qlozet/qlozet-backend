import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';

/**
 * The order emails, rendered for real.
 *
 * Worth doing because a broken template fails quietly: initializeTemplates
 * catches and logs, so a Handlebars typo leaves the compiled template
 * undefined and the first customer to pay gets no confirmation, with only a
 * line in the logs to say so.
 *
 * These render the actual .hbs files rather than mocking them, so a bad
 * expression or an unclosed block is caught here instead of in production.
 */

const VIEWS = path.join(__dirname, 'templates', 'views');
const PARTIALS = path.join(__dirname, 'templates', 'layouts', 'partials');

const render = (view: string, data: Record<string, unknown>): string => {
  for (const file of fs.readdirSync(PARTIALS)) {
    Handlebars.registerPartial(
      path.basename(file, '.hbs'),
      fs.readFileSync(path.join(PARTIALS, file), 'utf8'),
    );
  }
  const source = fs.readFileSync(path.join(VIEWS, `${view}.hbs`), 'utf8');
  return Handlebars.compile(source)(data);
};

const orderFields = {
  orderReference: 'QLZ-2026-00841',
  orderTotal: '₦42,500',
  itemCount: 2,
  singleItem: false,
  orderDate: '7 October 2026',
  companyName: 'Qlozet',
  supportEmail: 'support@qlozet.app',
  orderUrl: 'https://qlozet.app/profile?tab=orders',
};

describe('order emails', () => {
  describe('customer confirmation', () => {
    const html = () =>
      render('order-confirmation', {
        ...orderFields,
        customerName: 'Ada Obi',
        multipleVendors: false,
      });

    it('compiles', () => {
      expect(() => html()).not.toThrow();
    });

    it('carries the reference the customer will quote back at us', () => {
      expect(html()).toContain('QLZ-2026-00841');
    });

    it('shows the total and the date', () => {
      expect(html()).toContain('₦42,500');
      expect(html()).toContain('7 October 2026');
    });

    it('leaves no unresolved handlebars expressions', () => {
      // A mistyped field renders as empty, but a broken block leaves braces
      // in the output - which a customer would see.
      expect(html()).not.toMatch(/\{\{/);
    });

    it('warns against paying outside the platform', () => {
      expect(html()).toContain('Pay and message only through Qlozet');
    });

    it('reads naturally for one vendor and for several', () => {
      expect(
        render('order-confirmation', {
          ...orderFields,
          customerName: 'Ada',
          multipleVendors: false,
        }),
      ).toContain('maker is');
      expect(
        render('order-confirmation', {
          ...orderFields,
          customerName: 'Ada',
          multipleVendors: true,
        }),
      ).toContain('makers are');
    });

    it('says "1 item" rather than "1 items"', () => {
      const one = render('order-confirmation', {
        ...orderFields,
        itemCount: 1,
        singleItem: true,
        customerName: 'Ada',
      });
      expect(one).toContain('1 item');
      expect(one).not.toContain('1 items');
    });
  });

  describe('shipped', () => {
    const html = (trackingNumber = 'SB-88213-NG') =>
      render('order-shipped', {
        ...orderFields,
        customerName: 'Ada Obi',
        trackingNumber,
      });

    it('compiles', () => {
      expect(() => html()).not.toThrow();
    });

    it('shows the tracking number when the courier gave one', () => {
      expect(html()).toContain('SB-88213-NG');
      expect(html()).toContain('Tracking number');
    });

    it('drops the tracking block entirely when there is none', () => {
      // An empty box under a "Tracking number" heading reads as a fault.
      const none = html('');
      expect(none).not.toContain('Tracking number');
      expect(none).toContain('QLZ-2026-00841');
    });

    it('leaves no unresolved handlebars expressions', () => {
      expect(html()).not.toMatch(/\{\{/);
      expect(html('')).not.toMatch(/\{\{/);
    });
  });

  describe('delivered', () => {
    const html = () =>
      render('order-delivered', { ...orderFields, customerName: 'Ada Obi' });

    it('compiles', () => {
      expect(() => html()).not.toThrow();
    });

    it('asks for problems before it asks for a review', () => {
      const out = html();
      expect(out.indexOf('If something is wrong')).toBeLessThan(
        out.indexOf('review'),
      );
    });

    it('says the funds are still held, which is why speaking up now matters', () => {
      expect(html()).toContain('still held');
    });

    it('leaves no unresolved handlebars expressions', () => {
      expect(html()).not.toMatch(/\{\{/);
    });
  });

  describe('payout released', () => {
    const html = (orderReference = 'QLZ-2026-00841') =>
      render('payout-released', {
        vendorName: 'Kemi',
        amount: '₦38,250',
        orderReference,
        companyName: 'Qlozet',
        walletUrl: 'https://qlozet.app/wallet',
      });

    it('leads with the amount, which is the thing being announced', () => {
      expect(html()).toContain('₦38,250');
    });

    it('names the order when there is one, and reads cleanly without', () => {
      expect(html()).toContain('QLZ-2026-00841');
      const none = html('');
      expect(none).not.toContain('for order');
      expect(none).not.toMatch(/\{\{/);
    });
  });

  describe('product moderation', () => {
    const html = (approved: boolean, reason = 'Photos belong to another shop.') =>
      render('product-moderated', {
        vendorName: 'Kemi',
        productName: 'Ankara kaftan',
        approved,
        reason,
        companyName: 'Qlozet',
        productsUrl: 'https://qlozet.app/products',
      });

    it('tells an approved vendor it can go live', () => {
      const out = html(true);
      expect(out).toContain('approved');
      // The rejection copy must not leak into the approval.
      expect(out).not.toContain('moved back to draft');
    });

    it('gives a rejected vendor the reason', () => {
      expect(html(false)).toContain('Photos belong to another shop.');
    });

    it('reassures a rejected vendor nothing was deleted', () => {
      // Otherwise the first move is a support ticket asking where it went.
      // Whitespace is collapsed because the sentence wraps in the template.
      const flat = html(false).replace(/\s+/g, ' ');
      expect(flat).toContain('nothing of yours has been deleted');
    });

    it('still renders when no reason was recorded', () => {
      const out = html(false, '');
      expect(out).not.toMatch(/\{\{/);
    });

    it('leaves no unresolved handlebars expressions either way', () => {
      expect(html(true)).not.toMatch(/\{\{/);
      expect(html(false)).not.toMatch(/\{\{/);
    });
  });

  describe('vendor alert', () => {
    const html = () =>
      render('new-order-vendor', {
        ...orderFields,
        vendorName: 'Kemi',
        businessName: 'Kemi Couture',
      });

    it('compiles', () => {
      expect(() => html()).not.toThrow();
    });

    it('leads with the deadline the agreement sets', () => {
      expect(html()).toContain('48 hours');
    });

    it('names the business and the order', () => {
      expect(html()).toContain('Kemi Couture');
      expect(html()).toContain('QLZ-2026-00841');
    });

    it('says the figure shown is before commission', () => {
      // Otherwise a vendor reads the order value as their earnings and is
      // surprised by the payout.
      expect(html()).toContain('before commission');
    });

    it('leaves no unresolved handlebars expressions', () => {
      expect(html()).not.toMatch(/\{\{/);
    });
  });
});
