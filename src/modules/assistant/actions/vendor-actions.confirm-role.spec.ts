import { ForbiddenException } from '@nestjs/common';
import { VendorActionsService } from './vendor-actions.service';

/**
 * The assistant is not a side door: confirming an action it prepared is held
 * to the same team role as the route the action stands in for.
 */
const build = (kind: string) => {
  const doc: any = {
    _id: 'a1',
    kind,
    status: 'proposed',
    expires_at: new Date(Date.now() + 60_000),
    title: 't',
    summary: 's',
    details: [],
    params: {},
    result: null,
    result_text: null,
    error: null,
    save: jest.fn().mockResolvedValue(undefined),
  };
  const service: any = Object.create(VendorActionsService.prototype);
  Object.assign(service, {
    logger: { warn: jest.fn(), log: jest.fn() },
    owned: jest.fn().mockResolvedValue(doc),
    syncEmbedded: jest.fn().mockResolvedValue(undefined),
    execute: jest.fn().mockResolvedValue({ result: { ok: true }, text: 'done' }),
  });
  return { service: service as VendorActionsService, doc };
};

describe('VendorActionsService.confirm and team roles', () => {
  it('a tailor cannot confirm an order through the assistant', async () => {
    const { service, doc } = build('confirm_order');
    await expect(
      service.confirm('b1', 'u1', 'a1', { role: 'tailor', isOwner: false }),
    ).rejects.toThrow(
      new ForbiddenException(
        'Only the owner, operations or customer support can confirm or fulfil orders.',
      ),
    );
    // The card stays proposed for someone who may confirm it.
    expect(doc.status).toBe('proposed');
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('operations can; the owner always can', async () => {
    for (const member of [
      { role: 'operations', isOwner: false },
      { role: 'tailor', isOwner: true },
    ]) {
      const { service, doc } = build('confirm_order');
      await service.confirm('b1', 'u1', 'a1', member);
      expect(doc.status).toBe('executed');
    }
  });

  it('marketing may create a discount but not change stock', async () => {
    const ok = build('create_discount');
    await ok.service.confirm('b1', 'u1', 'a1', { role: 'marketing' });
    expect(ok.doc.status).toBe('executed');

    const no = build('update_stock');
    await expect(
      no.service.confirm('b1', 'u1', 'a1', { role: 'marketing' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('with no member context (an admin caller) the check does not apply', async () => {
    const { service, doc } = build('update_listing');
    await service.confirm('b1', 'u1', 'a1');
    expect(doc.status).toBe('executed');
  });
});
