import { BOT_EMAIL_SOURCE, BOT_NAME_SOURCE, botJoinReason, looksLikeBot } from './waitlist-bot';

// Entries seen on the live waitlist, Nov 2026.
const SEEN_BOTS: [string, string][] = [
  ['WxXpHBUgUJLikxCWoauKVbtN', 'l.uti.mu.fakec.e0.6@gmail.com'],
  ['HQdzUxGteqhZcGNbXGtTOsG', 'e.v.o.x.u.f.ocaz.o.f.5.0@gmail.com'],
  ['zFugXZCbsriXBqOXPy', 'l.e.vas.ev.ed.8.9@gmail.com'],
  ['npJzxgPfQePdjDLBhJjvDYsW', 'b.r.o.o.ksap6.m6.5.et.h.a.n@gmail.com'],
  ['zHAUUunXPmRAKzGtTjggas', 'eb.a.vaz.a.h9.1.7@gmail.com'],
  ['cjdXpqYkuEePZbcbQjhyl', 'g.u.s.u.sa.qa9.6@gmail.com'],
  ['mClDvJymmXGUotkgQ', 's.i.r.ij.u.k.ola70@gmail.com'],
  ['IxlMudiKWEtNyZmgL', 'y.uw.ori.nuwav.8.3@gmail.com'],
  ['rIOgbPnQDOlTdVlTkW', 'i.h.u.p.e.w.eqo.de.3.8.5@gmail.com'],
  ['hlvHfNKXScvoSiUUREKAguT', 'p.e.c.a.lut.u866@gmail.com'],
  ['HrHqhrIDwNyaRpYYWuYoI', 'b.iv.o.po.go445@gmail.com'],
  ['xfyeqMusxXNppUMFw', 'ah.o.sa.ziyan.2.16@gmail.com'],
  ['cUEiNkNKxJqCJTQohwbbAl', 'vod.a.k.e.ja.l.e.ri.7.0@gmail.com'],
  ['kJdRCLRwzFNwMlQSKqGZ', 'ad.u.q.iguce.05@gmail.com'],
  ['JDuaSUlHwTrToxtrJSJ', 'va.nef.ax.i.h.u00@gmail.com'],
  ['WJzmoWqgRDzMsrKltEPkZRb', 'ho.h.o.d.a.f.aro.g.3.9.6@gmail.com'],
];

const PEOPLE: [string, string][] = [
  ['Ada Okafor', 'ada.okafor@gmail.com'],
  ['Chukwuemeka Obi', 'c.e.obi@yahoo.com'],
  ['JohnPaulOkafor', 'johnpaul@gmail.com'],
  ['McDonald', 'mc@donald.ng'],
  ['Oluwaseun Adeyemi-Bakare', 'seun.adeyemi.bakare@outlook.com'],
  ['NGOZI', 'ngozi@business.ng'],
];

describe('waitlist bot rule', () => {
  it('catches every bot seen on the live list, by name and by email alone', () => {
    const name = new RegExp(BOT_NAME_SOURCE);
    const email = new RegExp(BOT_EMAIL_SOURCE);
    for (const [n, e] of SEEN_BOTS) {
      expect(name.test(n)).toBe(true);
      expect(email.test(e)).toBe(true);
      expect(looksLikeBot({ fullName: n, email: e })).toBe(true);
    }
  });

  it('lets ordinary names and emails through', () => {
    for (const [n, e] of PEOPLE) expect(looksLikeBot({ fullName: n, email: e })).toBe(false);
  });

  it('drops a filled hidden field or a form sent too fast', () => {
    const person = { fullName: 'Ada Okafor', email: 'ada@gmail.com' };
    expect(botJoinReason(person)).toBeNull();
    expect(botJoinReason({ ...person, form_ms: 6000 })).toBeNull();
    expect(botJoinReason({ ...person, website: 'http://spam' })).toBe('honeypot');
    expect(botJoinReason({ ...person, form_ms: 400 })).toBe('too_fast');
    expect(botJoinReason({ fullName: SEEN_BOTS[0][0], email: 'x@y.com' })).toBe('pattern');
  });
});
