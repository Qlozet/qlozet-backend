import { UserController } from '../../modules/ums/users.controller';
import { ProductsController } from '../../modules/products/products.controller';
import { TransactionController } from '../../modules/transactions/transactions.controller';
import { BespokeController } from '../../modules/bespoke/bespoke.controller';
import { DiscountController } from '../../modules/products/discount.controller';
import { VENDOR_ROLES_KEY } from '../decorators/vendor-roles.decorator';
import { hideMoneyUnlessAllowed, vendorRolesFor } from './vendor-access';

/**
 * Routes that were open to anyone signed in, or to the wrong team roles.
 * A route with no @Roles skips the roles guard entirely, so these pin the
 * decorators that keep them shut.
 */
const roles = (cls: any, method: string): string[] =>
  Reflect.getMetadata('roles', cls.prototype[method]) ?? [];
const vendorRoles = (cls: any, method: string): string[] =>
  Reflect.getMetadata(VENDOR_ROLES_KEY, cls.prototype[method]) ?? [];

describe('route guards', () => {
  it('platform settings can only be changed by staff', () => {
    const r = roles(UserController, 'update');
    expect(r.length).toBeGreaterThan(0);
    expect(r).not.toContain('vendor');
    expect(r).not.toContain('customer');
  });

  it('stock by hand is for the roles that manage products, on their own store', () => {
    for (const m of ['updateFabricStock', 'updateAccessoryVariantStock']) {
      expect(roles(ProductsController, m)).toEqual(['vendor']);
      expect(vendorRoles(ProductsController, m).sort()).toEqual(
        vendorRolesFor('products.manage').sort(),
      );
    }
  });

  it('a payment by reference is for money roles on the store side', () => {
    expect(vendorRoles(TransactionController, 'getByReference').sort()).toEqual(
      vendorRolesFor('money.view').sort(),
    );
  });

  it('only order-handling roles can quote a price', () => {
    for (const m of ['saveQuoteDraft', 'submitQuote']) {
      expect(vendorRoles(BespokeController, m).sort()).toEqual(
        vendorRolesFor('orders.fulfil').sort(),
      );
    }
  });

  it('routes follow the same role table the app shows', () => {
    expect(vendorRoles(DiscountController, 'applyDiscount').sort()).toEqual(
      vendorRolesFor('discounts.manage').sort(),
    );
    expect(vendorRoles(ProductsController, 'delete').sort()).toEqual(
      vendorRolesFor('products.manage').sort(),
    );
  });
});

describe('money on shared dashboards', () => {
  const body = {
    summary: {
      totalOrders: 4,
      totalEarnings: 52000,
      totalEarningsChange: '+3%',
    },
    data: {
      total_revenue: 9,
      data: [{ name: 'Agbada', revenue: 9, orders: 2 }],
    },
    gross_sales: 70000,
  };

  it('a tailor sees counts, not money', () => {
    const out: any = hideMoneyUnlessAllowed(body, 'tailor', false);
    expect(out.summary.totalOrders).toBe(4);
    expect(out.summary.totalEarnings).toBeNull();
    expect(out.data.data[0]).toEqual({
      name: 'Agbada',
      revenue: null,
      orders: 2,
    });
    expect(out.gross_sales).toBeNull();
  });

  it('the owner and money roles see everything', () => {
    expect(hideMoneyUnlessAllowed(body, 'owner', true)).toBe(body);
    expect(hideMoneyUnlessAllowed(body, 'sales', false)).toBe(body);
  });
});
