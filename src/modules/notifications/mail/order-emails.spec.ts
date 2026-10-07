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
