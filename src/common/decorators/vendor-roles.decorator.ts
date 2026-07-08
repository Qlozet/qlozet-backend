import { SetMetadata } from '@nestjs/common';

export const VENDOR_ROLES_KEY = 'vendor_roles';

/**
 * Decorator to restrict a vendor endpoint to specific VendorRole names.
 * Must be used alongside @Roles(UserType.VENDOR).
 *
 * Owner always bypasses this check — they can access everything.
 *
 * Usage:
 *   @Roles(UserType.VENDOR)
 *   @VendorRoles(VendorRole.OWNER, VendorRole.OPERATIONS)
 */
export const VendorRoles = (...roles: string[]) =>
  SetMetadata(VENDOR_ROLES_KEY, roles);
