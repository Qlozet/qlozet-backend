import { MailService } from './mail.service';

/**
 * The account emails, rendered through the real templates and the real send
 * methods. The templates read {{name}} and {{verificationLink}}; the methods
 * used to pass userName and verificationUrl, so every one said "Hello ," and
 * the verify button went nowhere. This checks what actually lands in the HTML.
 */
describe('account emails', () => {
  let service: any;
  let sent: { to: string; subject: string; html: string }[];

  beforeAll(async () => {
    service = Object.create(MailService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service.templates = {
      verification: await service.loadTemplate('email-verification'),
      passwordResetSuccess: await service.loadTemplate('password-reset-success'),
      passwordUpdated: await service.loadTemplate('password-updated'),
      announcement: await service.loadTemplate('announcement'),
    };
  });

  beforeEach(() => {
    sent = [];
    service.dispatch = jest.fn(async (m: any) => sent.push(m));
  });

  it('verification email greets by name and links the button', async () => {
    const link = 'https://vendor.example/auth/verification?email=ada%40example.com';
    await service.sendVerificationEmail('ada@example.com', 'Ada Obi', link, '482913');
    const html = sent[0].html;
    expect(html).toContain('Ada Obi');
    expect(html).toContain('482913');
    // Handlebars escapes '=' in the link; what matters is that it is there
    // and no button or link is left empty.
    expect(html).toContain('https://vendor.example/auth/verification?email');
    expect(html).not.toMatch(/href="\s*"/);
  });

  it('password emails greet by name', async () => {
    await service.sendPasswordResetSuccessEmail('ada@example.com', 'Ada Obi');
    await service.sendPasswordUpdatedEmail('ada@example.com', 'Ada Obi');
    for (const m of sent) expect(m.html).toMatch(/Hello <strong>Ada Obi<\/strong>/);
  });

  it('announcement shows the button only with a link', async () => {
    await service.sendAnnouncementEmail('a@b.co', 'News', '<p>Hi</p>', 'Ada', 'https://shop.example');
    await service.sendAnnouncementEmail('a@b.co', 'News', '<p>Hi</p>', 'Ada');
    expect(sent[0].html).toContain('https://shop.example');
    expect(sent[1].html).not.toContain('Open Qlozet');
  });
});
