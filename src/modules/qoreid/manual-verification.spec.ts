import {
  cleanRcNumber,
  fullCheckDueAt,
  graceDays,
  manualSubmitProblem,
  missingManualChecks,
  pastFullCheckDeadline,
  verificationMode,
} from './manual-verification';
import { getVendorAgreement } from '../business/agreements';
import { SERVICE_AGREEMENT } from '../business/service-agreement';

describe('manual vendor verification', () => {
  const ready = {
    verification_state: 'not_started',
    payout_account_number: '0123456789',
    payout_account_name: 'ADA STITCHES LTD',
  };
  const ok = { mode: 'manual' as const, agreementAccepted: true, rcNumber: 'RC123456' };

  it('defaults to QoreID and 30 days', () => {
    expect(verificationMode(null)).toBe('qoreid');
    expect(verificationMode({ vendor_verification_mode: 'manual' })).toBe('manual');
    expect(graceDays({})).toBe(30);
    expect(graceDays({ manual_verification_grace_days: 14 })).toBe(14);
    expect(graceDays({ manual_verification_grace_days: 0 })).toBe(30);
  });

  it('reads CAC numbers loosely and rejects junk', () => {
    expect(cleanRcNumber(' rc 1234567 ')).toBe('RC1234567');
    expect(cleanRcNumber('BN3456789')).toBe('BN3456789');
    expect(cleanRcNumber('1234567')).toBe('1234567');
    expect(cleanRcNumber('hello')).toBeNull();
    expect(cleanRcNumber('')).toBeNull();
  });

  it('lets a vendor submit once agreement, CAC number and payout account are in', () => {
    expect(manualSubmitProblem(ready, ok)).toBeNull();
    expect(manualSubmitProblem(ready, { ...ok, mode: 'qoreid' })).toMatch(/identity checks/);
    expect(manualSubmitProblem(ready, { ...ok, agreementAccepted: false })).toMatch(/agreement/);
    expect(manualSubmitProblem(ready, { ...ok, rcNumber: null })).toMatch(/CAC/);
    expect(manualSubmitProblem({ ...ready, payout_account_name: null }, ok)).toMatch(/payout account/);
    expect(manualSubmitProblem({ ...ready, verification_state: 'awaiting_review' }, ok)).toMatch(/under review/);
    expect(manualSubmitProblem({ ...ready, verification_state: 'approved' }, ok)).toMatch(/already approved/);
    // A vendor told to fix something may resubmit.
    expect(manualSubmitProblem({ ...ready, verification_state: 'action_required' }, ok)).toBeNull();
  });

  it('approves only with every check ticked', () => {
    expect(missingManualChecks({})).toEqual(['cac_register', 'payout_name', 'owner_call']);
    expect(missingManualChecks({ cac_register: true, payout_name: true })).toEqual(['owner_call']);
    expect(missingManualChecks({ cac_register: true, payout_name: true, owner_call: true })).toEqual([]);
  });

  it('pauses only manually approved vendors past their deadline', () => {
    const now = new Date('2026-12-10T08:00:00Z');
    const due = fullCheckDueAt(new Date('2026-11-05T08:00:00Z'), 30);
    expect(due.toISOString()).toBe('2026-12-05T08:00:00.000Z');
    const b = { verification_method: 'manual', verification_state: 'approved', full_verification_due_at: due };
    expect(pastFullCheckDeadline(b, now)).toBe(true);
    expect(pastFullCheckDeadline({ ...b, full_verification_due_at: null }, now)).toBe(false);
    expect(pastFullCheckDeadline({ ...b, verification_method: 'qoreid' }, now)).toBe(false);
    expect(pastFullCheckDeadline(b, new Date('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('the agreement in force covers manual verification and the deadline', () => {
    const text = getVendorAgreement(SERVICE_AGREEMENT.VERSION)!;
    expect(text).toContain(`**Version ${SERVICE_AGREEMENT.VERSION}**`);
    expect(text).toMatch(/Manual verification/);
    expect(text).toMatch(/Finishing full verification/);
    // Earlier versions stay readable, word for word.
    expect(getVendorAgreement('2026-10-31')).toContain('**Version 2026-10-31**');
  });
});
