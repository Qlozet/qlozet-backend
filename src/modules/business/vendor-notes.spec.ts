import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { VendorNotesService } from './vendor-notes.service';
import { VendorNoteKind } from './schemas/vendor-note.schema';

const BUSINESS = new Types.ObjectId();
const ADMIN = new Types.ObjectId().toString();

const buildService = (overrides: {
  note?: Record<string, unknown> | null;
  businessExists?: boolean;
  openFlags?: number;
} = {}) => {
  const businessUpdates: { filter: any; update: any }[] = [];
  const created: Record<string, unknown>[] = [];
  let savedNote: any;

  const service = Object.create(VendorNotesService.prototype) as VendorNotesService;

  const makeNote = (patch: Record<string, unknown>) => {
    const note: any = {
      _id: new Types.ObjectId(),
      business: BUSINESS,
      kind: VendorNoteKind.NOTE,
      resolved: false,
      ...patch,
      save: jest.fn(function (this: any) {
        savedNote = this;
        return Promise.resolve(this);
      }),
      toObject: jest.fn(function (this: any) {
        return { ...this };
      }),
    };
    return note;
  };

  Object.assign(service, {
    noteModel: {
      create: jest.fn((doc: Record<string, unknown>) => {
        created.push(doc);
        return Promise.resolve(makeNote(doc));
      }),
      findById: jest.fn(() =>
        Promise.resolve(
          overrides.note === null ? null : makeNote(overrides.note ?? {}),
        ),
      ),
      countDocuments: jest.fn(() => Promise.resolve(overrides.openFlags ?? 0)),
      deleteOne: jest.fn(() => Promise.resolve({ deletedCount: 1 })),
      find: jest.fn(() => ({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              populate: () => ({
                populate: () => ({ lean: () => Promise.resolve([]) }),
              }),
            }),
          }),
        }),
      })),
    },
    businessModel: {
      exists: jest.fn(() =>
        Promise.resolve(overrides.businessExists === false ? null : { _id: BUSINESS }),
      ),
      updateOne: jest.fn((filter: any, update: any) => {
        businessUpdates.push({ filter, update });
        return Promise.resolve({ modifiedCount: 1 });
      }),
    },
  });

  return { service, businessUpdates, created, getSaved: () => savedNote };
};

describe('VendorNotesService.create', () => {
  it('rejects a bad id before touching the collection', async () => {
    const { service } = buildService();
    await expect(
      service.create('nope', ADMIN, { body: 'hi' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s for a business that does not exist', async () => {
    const { service } = buildService({ businessExists: false });
    await expect(
      service.create(BUSINESS.toString(), ADMIN, { body: 'hi' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('records the author, so the trail is attributable', async () => {
    const { service, created } = buildService();

    await service.create(BUSINESS.toString(), ADMIN, { body: '  spaced  ' });

    expect(created[0].author?.toString()).toBe(ADMIN);
    // Trimmed: trailing whitespace in a note body is never meaningful.
    expect(created[0].body).toBe('spaced');
    expect(created[0].kind).toBe(VendorNoteKind.NOTE);
  });

  it('does not mark the vendor flagged for an ordinary note', async () => {
    const { service, businessUpdates } = buildService();
    await service.create(BUSINESS.toString(), ADMIN, { body: 'called them' });
    expect(businessUpdates).toHaveLength(0);
  });

  it('marks the vendor flagged when the note is a flag', async () => {
    const { service, businessUpdates } = buildService({ openFlags: 1 });

    await service.create(BUSINESS.toString(), ADMIN, {
      body: 'late fulfilment',
      kind: VendorNoteKind.FLAG,
    });

    expect(businessUpdates[0].update).toEqual({ $set: { is_flagged: true } });
  });
});

describe('VendorNotesService.resolve', () => {
  it('refuses to resolve an ordinary note', async () => {
    // A "resolved" note would just be a hidden one.
    const { service } = buildService({ note: { kind: VendorNoteKind.NOTE } });
    await expect(
      service.resolve(new Types.ObjectId().toString(), ADMIN),
    ).rejects.toThrow(BadRequestException);
  });

  it('records who cleared the flag and when', async () => {
    const { service, getSaved } = buildService({
      note: { kind: VendorNoteKind.FLAG },
    });

    await service.resolve(new Types.ObjectId().toString(), ADMIN);

    const saved = getSaved();
    expect(saved.resolved).toBe(true);
    expect(saved.resolved_by.toString()).toBe(ADMIN);
    expect(saved.resolved_at).toBeInstanceOf(Date);
  });

  it('keeps the vendor flagged while another flag is still open', async () => {
    // Toggling is_flagged to false on any resolve would clear the mark while
    // other concerns were outstanding — so it is recounted, not toggled.
    const { service, businessUpdates } = buildService({
      note: { kind: VendorNoteKind.FLAG },
      openFlags: 2,
    });

    await service.resolve(new Types.ObjectId().toString(), ADMIN);

    expect(businessUpdates[0].update).toEqual({ $set: { is_flagged: true } });
  });

  it('un-flags the vendor once the last flag is cleared', async () => {
    const { service, businessUpdates } = buildService({
      note: { kind: VendorNoteKind.FLAG },
      openFlags: 0,
    });

    await service.resolve(new Types.ObjectId().toString(), ADMIN);

    expect(businessUpdates[0].update).toEqual({ $set: { is_flagged: false } });
  });

  it('404s for a note that is not there', async () => {
    const { service } = buildService({ note: null });
    await expect(
      service.resolve(new Types.ObjectId().toString(), ADMIN),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('VendorNotesService.remove', () => {
  it('recomputes the flag when a flag is deleted', async () => {
    const { service, businessUpdates } = buildService({
      note: { kind: VendorNoteKind.FLAG },
      openFlags: 0,
    });

    await service.remove(new Types.ObjectId().toString());

    expect(businessUpdates[0].update).toEqual({ $set: { is_flagged: false } });
  });

  it('leaves the flag alone when an ordinary note is deleted', async () => {
    const { service, businessUpdates } = buildService({
      note: { kind: VendorNoteKind.NOTE },
    });

    await service.remove(new Types.ObjectId().toString());

    expect(businessUpdates).toHaveLength(0);
  });

  it('404s for a note that is not there', async () => {
    const { service } = buildService({ note: null });
    await expect(
      service.remove(new Types.ObjectId().toString()),
    ).rejects.toThrow(NotFoundException);
  });
});
