import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AskConversationsService } from './ask-conversations.service';

/**
 * Stylist conversation memory.
 *
 * The thread used to live only in a React useState on the search page; the
 * server kept nothing. These pin down the contract the clock button on the
 * search page now depends on: a thread is created on the first exchange,
 * grows on the next, is only ever read back to its owner, and failing to
 * remember an answer never fails the answer.
 */
describe('AskConversationsService', () => {
  const ME = String(new Types.ObjectId());
  const OTHER = String(new Types.ObjectId());

  let docs: any[];
  let model: any;
  let service: AskConversationsService;

  const chain = (result: any) => {
    const c: any = {};
    for (const m of ['sort', 'limit', 'select', 'populate']) c[m] = () => c;
    c.lean = () => Promise.resolve(result);
    c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return c;
  };

  beforeEach(() => {
    docs = [];
    model = {
      create: jest.fn(async (fields: any) => {
        const d = { _id: new Types.ObjectId(), ...fields };
        docs.push(d);
        return d;
      }),
      findOneAndUpdate: jest.fn(async (filter: any, update: any) => {
        const d = docs.find(
          (x) => String(x._id) === String(filter._id) && String(x.user) === String(filter.user),
        );
        if (!d) return null;
        d.messages.push(...update.$push.messages.$each);
        d.last_message_at = update.$set.last_message_at;
        return d;
      }),
      findById: jest.fn((id: any) =>
        chain(docs.find((x) => String(x._id) === String(id)) ?? null),
      ),
      find: jest.fn((filter: any) =>
        chain(
          docs
            .filter((x) => String(x.user) === String(filter.user))
            .sort((a, b) => b.last_message_at - a.last_message_at),
        ),
      ),
      deleteOne: jest.fn(async (filter: any) => {
        docs = docs.filter((x) => String(x._id) !== String(filter._id));
        return { deletedCount: 1 };
      }),
      deleteMany: jest.fn(async (filter: any) => {
        const before = docs.length;
        docs = docs.filter((x) => String(x.user) !== String(filter.user));
        return { deletedCount: before - docs.length };
      }),
    };
    service = new AskConversationsService(model);
  });

  it('starts a conversation on the first exchange and titles it after the question', async () => {
    const id = await service.record(ME, null, '  red   dress for a wedding ', 'Try these.', [
      String(new Types.ObjectId()),
    ]);

    expect(id).toBeTruthy();
    expect(model.create).toHaveBeenCalledTimes(1);
    const d = docs[0];
    expect(d.title).toBe('red dress for a wedding');
    expect(d.messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(d.messages[1].product_ids).toHaveLength(1);
  });

  it('appends to the named conversation and returns the same id', async () => {
    const id = await service.record(ME, null, 'agbada', 'Here.', []);
    const again = await service.record(ME, id, 'in blue?', 'Blue ones.', []);

    expect(again).toBe(id);
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(docs[0].messages).toHaveLength(4);
  });

  it("starts a fresh conversation rather than appending to someone else's", async () => {
    const theirs = await service.record(OTHER, null, 'kaftan', 'Sure.', []);
    const mine = await service.record(ME, theirs, 'kaftan', 'Sure.', []);

    expect(mine).not.toBe(theirs);
    expect(docs.find((d) => String(d._id) === theirs).messages).toHaveLength(2);
  });

  it('never throws from record - the answer has already been produced', async () => {
    model.create.mockRejectedValueOnce(new Error('mongo down'));
    await expect(service.record(ME, null, 'q', 'a', [])).resolves.toBeNull();
  });

  it('drops product ids that are not ObjectIds instead of failing the write', async () => {
    await service.record(ME, null, 'q', 'a', ['not-an-id', String(new Types.ObjectId())]);
    expect(docs[0].messages[1].product_ids).toHaveLength(1);
  });

  it('hands the pipeline the stored turns, not whatever the client re-sent', async () => {
    const id = await service.record(ME, null, 'agbada', 'Here.', []);
    await service.record(ME, id, 'in blue?', 'Blue ones.', []);

    const history = await service.historyFor(ME, id!);
    expect(history).toEqual([
      { role: 'user', content: 'agbada' },
      { role: 'assistant', content: 'Here.' },
      { role: 'user', content: 'in blue?' },
      { role: 'assistant', content: 'Blue ones.' },
    ]);
  });

  it('lists only my conversations, most recent first, with a message count', async () => {
    const first = await service.record(ME, null, 'first', 'a', []);
    await new Promise((r) => setTimeout(r, 2));
    await service.record(ME, null, 'second', 'a', []);
    await service.record(OTHER, null, 'theirs', 'a', []);
    await service.record(ME, first, 'more', 'a', []);

    const rows = await service.list(ME);
    expect(rows.map((r) => r.title)).toEqual(['first', 'second']);
    expect(rows[0].message_count).toBe(4);
    expect(rows.some((r) => r.title === 'theirs')).toBe(false);
  });

  it("answers 404 for a conversation that is someone else's, or malformed", async () => {
    const theirs = await service.record(OTHER, null, 'kaftan', 'Sure.', []);

    await expect(service.get(ME, theirs!)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(ME, theirs!)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.get(ME, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(docs).toHaveLength(1);
  });

  it('deletes one, and deletes all of mine without touching theirs', async () => {
    const a = await service.record(ME, null, 'a', 'a', []);
    await service.record(ME, null, 'b', 'b', []);
    await service.record(OTHER, null, 'c', 'c', []);

    await expect(service.remove(ME, a!)).resolves.toEqual({ deleted: true });
    await expect(service.removeAll(ME)).resolves.toEqual({ deleted: 1 });
    expect(docs.map((d) => d.title)).toEqual(['c']);
  });
});
