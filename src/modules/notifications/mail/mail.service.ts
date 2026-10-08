import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';

type CompiledTemplate = (data: any) => string;

interface EmailTemplates {
  verification: CompiledTemplate;
  passwordReset: CompiledTemplate;
  passwordResetSuccess: CompiledTemplate;
  passwordUpdated: CompiledTemplate;
  vendorWelcome: CompiledTemplate;
  customerWelcome: CompiledTemplate;
  inviteUser: CompiledTemplate;
  orderConfirmation: CompiledTemplate;
  newOrderVendor: CompiledTemplate;
  orderShipped: CompiledTemplate;
  orderDelivered: CompiledTemplate;
  payoutReleased: CompiledTemplate;
  productModerated: CompiledTemplate;
  adminInvite: CompiledTemplate;
  teamAdded: CompiledTemplate;
  quoteRequest: CompiledTemplate;
  quoteSubmitted: CompiledTemplate;
  quoteRevision: CompiledTemplate;
}

import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EmailLog,
  EmailLogDocument,
  EmailStatus,
} from '../schemas/email-log.schema';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  private templates: Partial<EmailTemplates> = {};

  constructor(
    private readonly mailerService: MailerService,
    @InjectModel(EmailLog.name)
    private readonly emailLogModel: Model<EmailLogDocument>,
  ) {
    this.initializeTemplates();
  }

  // ✅ Robust template path resolver (works for local + Docker + Fly)
  private getTemplatesBasePath(): string {
    const localSrcPath = path.join(
      process.cwd(),
      'src',
      'modules',
      'notifications',
      'mail',
      'templates',
    );
    const distPath = path.join(__dirname, 'templates');
    const altDistPath = path.join(
      __dirname,
      '../../modules/notifications/mail/templates',
    );
    const dockerDistPath = path.join(
      process.cwd(),
      'dist',
      'modules',
      'notifications',
      'mail',
      'templates',
    );

    if (fs.existsSync(localSrcPath)) {
      this.logger.log('📂 Using local template path:', localSrcPath);
      return localSrcPath;
    }
    if (fs.existsSync(distPath)) {
      this.logger.log('📂 Using dist template path:', distPath);
      return distPath;
    }
    if (fs.existsSync(altDistPath)) {
      this.logger.log('📂 Using alt dist template path:', altDistPath);
      return altDistPath;
    }
    if (fs.existsSync(dockerDistPath)) {
      this.logger.log('📂 Using docker dist template path:', dockerDistPath);
      return dockerDistPath;
    }

    this.logger.warn('⚠️ No valid templates directory found.');
    return localSrcPath; // fallback
  }

  private async initializeTemplates() {
    try {
      this.logger.log('🟡 Initializing email templates...');
      await this.registerPartials();

      this.templates = {
        verification: await this.loadTemplate('email-verification'),
        passwordReset: await this.loadTemplate('password-reset-request'),
        passwordResetSuccess: await this.loadTemplate('password-reset-success'),
        passwordUpdated: await this.loadTemplate('password-updated'),
        vendorWelcome: await this.loadTemplate('vendor-welcome'),
        customerWelcome: await this.loadTemplate('customer-welcome'),
        inviteUser: await this.loadTemplate('invite-user'),
        orderConfirmation: await this.loadTemplate('order-confirmation'),
        newOrderVendor: await this.loadTemplate('new-order-vendor'),
        orderShipped: await this.loadTemplate('order-shipped'),
        orderDelivered: await this.loadTemplate('order-delivered'),
        payoutReleased: await this.loadTemplate('payout-released'),
        productModerated: await this.loadTemplate('product-moderated'),
        adminInvite: await this.loadTemplate('admin-invite'),
        teamAdded: await this.loadTemplate('team-added'),
        quoteRequest: await this.loadTemplate('quote-request'),
        quoteSubmitted: await this.loadTemplate('quote-submitted'),
        quoteRevision: await this.loadTemplate('quote-revision'),
      };

      this.logger.log('✅ All email templates initialized successfully!');
    } catch (error) {
      this.logger.error('❌ Failed to initialize email templates:', error);
    }
  }

  /**
   * The one place an email actually leaves.
   *
   * Every send goes through here so each is recorded and logged the same way.
   * Before this there were eighteen call sites and thirty-two console lines:
   * no two failures looked alike and none of them outlived the process.
   *
   * Recording never blocks the send and never fails it. If the log write
   * throws, the email has still gone, and the caller should not hear about a
   * bookkeeping problem.
   */
  private async dispatch(message: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    try {
      await this.mailerService.sendMail(message);
      this.logger.log(`Sent "${message.subject}" to ${message.to}`);
      void this.record(message, EmailStatus.SENT);
    } catch (error: any) {
      this.logger.error(
        `Failed "${message.subject}" to ${message.to}: ${error?.message}`,
      );
      void this.record(message, EmailStatus.FAILED, error?.message);
      throw error;
    }
  }

  private async record(
    message: { to: string; subject: string },
    status: EmailStatus,
    error?: string,
  ): Promise<void> {
    try {
      await this.emailLogModel.create({
        // Lower-cased on the way in so a provider echoing a differently-cased
        // address still matches the row. Local parts are case-sensitive in
        // theory; no mail system in practice treats them that way.
        to: message.to.toLowerCase(),
        subject: message.subject,
        status,
        error: error ?? null,
      });
    } catch (err: any) {
      this.logger.warn(`Could not record email attempt: ${err?.message}`);
    }
  }

  /**
   * Apply a delivery event from ZeptoMail to the row we wrote when sending.
   *
   * Matching is by recipient and subject, newest first, because nothing
   * reliably carries our own id end to end: ZeptoMail's client_reference is
   * set per-send through its API, and these go out over SMTP. Recipient plus
   * subject is unambiguous in practice — the same person does not receive two
   * identically-subjected emails within the same second — and the provider's
   * own reference is stored on first contact so the two can be reconciled by
   * hand if they ever do disagree.
   *
   * Unmatched events are logged, not an error. A message sent before this
   * table existed, or outside the 90-day window, has no row to update, and
   * that is not a fault worth alarming anyone about.
   */
  async applyDeliveryEvent(event: {
    to: string;
    subject?: string;
    status: EmailStatus;
    providerReference?: string;
    detail?: string;
  }): Promise<void> {
    const query: Record<string, unknown> = { to: event.to.toLowerCase() };
    if (event.subject) query.subject = event.subject;

    const row = await this.emailLogModel
      .findOne(query)
      .sort({ createdAt: -1 })
      .exec();

    if (!row) {
      this.logger.warn(
        `Delivery event "${event.status}" for ${event.to} matched no sent email`,
      );
      return;
    }

    row.status = event.status;
    row.status_updated_at = new Date();
    if (event.providerReference) row.provider_reference = event.providerReference;
    if (event.detail) row.error = event.detail;
    await row.save();

    // A hard bounce means this address will never work again. Worth noticing:
    // a vendor whose address is dead silently misses every new-order alert,
    // and that one carries a 48-hour deadline.
    if (event.status === EmailStatus.HARD_BOUNCE) {
      this.logger.error(
        `Hard bounce for ${event.to} — this address is undeliverable and ` +
          `should be corrected before more mail is sent to it`,
      );
    }
  }

  private async registerPartials() {
    const templatesBasePath = this.getTemplatesBasePath();
    const partialsDir = path.join(templatesBasePath, 'layouts', 'partials');

    try {
      await fsp.access(partialsDir);
      const partialFiles = await fsp.readdir(partialsDir);

      for (const file of partialFiles) {
        if (file.endsWith('.hbs')) {
          const partialName = path.basename(file, '.hbs');
          const partialPath = path.join(partialsDir, file);
          const partialContent = await fsp.readFile(partialPath, 'utf-8');
          handlebars.registerPartial(partialName, partialContent);
          this.logger.log(`✅ Registered partial: ${partialName}`);
        }
      }

      this.logger.log('🎉 All partials registered successfully!');
    } catch (error: any) {
      this.logger.warn('⚠️ Could not load email partials:', error.message);
      this.logger.log('Partials directory attempted:', partialsDir);
    }
  }

  private async loadTemplate(templateName: string): Promise<CompiledTemplate> {
    const templatesBasePath = this.getTemplatesBasePath();

    try {
      const layoutPath = path.join(templatesBasePath, 'layouts', 'main.hbs');
      const templatePath = path.join(
        templatesBasePath,
        'views',
        `${templateName}.hbs`,
      );

      await fsp.access(layoutPath);
      await fsp.access(templatePath);

      const [layoutContent, templateContent] = await Promise.all([
        fsp.readFile(layoutPath, 'utf-8'),
        fsp.readFile(templatePath, 'utf-8'),
      ]);

      const partialsDir = path.join(templatesBasePath, 'layouts', 'partials');
      try {
        const partialFiles = await fsp.readdir(partialsDir);
        for (const file of partialFiles) {
          const partialPath = path.join(partialsDir, file);
          const partialName = path.parse(file).name;
          const partialContent = await fsp.readFile(partialPath, 'utf-8');
          handlebars.registerPartial(partialName, partialContent);
        }
      } catch {
        this.logger.warn(`⚠️ No partials found in ${partialsDir}`);
      }

      const layoutTemplate = handlebars.compile(layoutContent);
      const bodyTemplate = handlebars.compile(templateContent);

      return (data: any) => {
        const templateData = this.getTemplateData(data);
        return layoutTemplate({
          ...templateData,
          body: bodyTemplate(templateData),
        });
      };
    } catch (error) {
      this.logger.error(`❌ Failed to load template: ${templateName}`, error);
      throw new Error(`Template ${templateName} not found or invalid`);
    }
  }

  private getTemplateData(customData: any) {
    const currentYear = new Date().getFullYear();

    /**
     * Fallbacks are real values, not placeholders.
     *
     * These were "Your App", "support@yourapp.com", "123 Business St" and a
     * via.placeholder.com image reading LOGO — which is what a customer saw
     * on any environment where the variables were unset, and they are not
     * documented anywhere, so that was most of them. A wrong default in an
     * email is worse than a missing one: nobody notices it until a customer
     * asks who Your App are.
     */
    return {
      ...customData,
      year: currentYear,
      websiteUrl: process.env.FRONTEND_URL || 'https://qlozet.app',
      companyName: process.env.COMPANY_NAME || 'Qlozet',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@qlozet.app',
      // Omitted rather than guessed. The footer skips the line when there is
      // no address, which beats inventing one.
      companyAddress: process.env.COMPANY_ADDRESS || '',
      /**
       * Unset means no image, which is deliberate: the layout then draws the
       * name as a wordmark in white on the brand bar. A broken or
       * placeholder image is worse than clean type, and a logo file has to
       * be a transparent or brown-matched PNG to sit on that bar at all.
       */
      companyLogoUrl: process.env.COMPANY_LOGO_URL || '',
    };
  }

  // ================================================================
  // EMAIL SENDING METHODS
  // ================================================================

  async sendVerificationEmail(
    to: string,
    name: string,
    verificationLink: string,
    verificationCode: string,
  ) {
    try {
      if (!this.templates.verification)
        throw new Error('Verification template not loaded');

      const html = this.templates.verification({
        userName: name,
        verificationUrl: verificationLink,
        verificationCode,
        expiryTime: '24 hours',
        subject: 'Verify Your Email Address',
      });

      await this.dispatch({
        to,
        subject: 'Verify Your Email Address',
        html,
      });

      this.logger.log('✅ Verification email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send verification email:', error);
      throw error;
    }
  }

  async sendResetCodeEmail(to: string, name: string, code: string) {
    try {
      if (!this.templates.passwordReset)
        throw new Error('Password reset template not loaded');

      const html = this.templates.passwordReset({
        userName: name,
        resetCode: code,
        expiryTime: '15 minutes',
        subject: 'Your Password Reset Code',
      });

      await this.dispatch({
        to,
        subject: 'Your Password Reset Code',
        html,
      });

      this.logger.log('✅ Password reset code email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send password reset code email:', error);
      throw error;
    }
  }

  async sendPasswordResetSuccessEmail(to: string, name: string) {
    try {
      if (!this.templates.passwordResetSuccess)
        throw new Error('Password reset success template not loaded');

      const html = this.templates.passwordResetSuccess({
        userName: name,
        currentDate: new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        subject: 'Password Reset Successful',
      });

      await this.dispatch({
        to,
        subject: 'Password Reset Successful',
        html,
      });

      this.logger.log('✅ Password reset success email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send password reset success email:', error);
      throw error;
    }
  }

  async sendPasswordUpdatedEmail(to: string, name: string) {
    try {
      if (!this.templates.passwordUpdated)
        throw new Error('Password updated template not loaded');

      const html = this.templates.passwordUpdated({
        userName: name,
        updateDate: new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        subject: 'Password Updated Successfully',
      });

      await this.dispatch({
        to,
        subject: 'Password Updated Successfully',
        html,
      });

      this.logger.log('✅ Password updated email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send password updated email:', error);
      throw error;
    }
  }

  async sendVendorWelcomeEmail(to: string, name: string, businessName: string) {
    try {
      if (!this.templates.vendorWelcome)
        throw new Error('Vendor welcome template not loaded');

      const html = this.templates.vendorWelcome({
        userName: name,
        businessName,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'Our Platform'}!`,
        dashboardUrl: `${
          process.env.FRONTEND_URL || 'https://yourapp.com'
        }/vendor/dashboard`,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@yourapp.com',
        setupGuideUrl: `${
          process.env.FRONTEND_URL || 'https://yourapp.com'
        }/vendor/setup-guide`,
      });

      await this.dispatch({
        to,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'Our Platform'}!`,
        html,
      });

      this.logger.log('✅ Vendor welcome email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send vendor welcome email:', error);
      throw error;
    }
  }

  async sendCustomerWelcomeEmail(to: string, name: string) {
    try {
      if (!this.templates.customerWelcome)
        throw new Error('Customer welcome template not loaded');

      const html = this.templates.customerWelcome({
        userName: name,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'Our Platform'}!`,
        exploreUrl: `${
          process.env.FRONTEND_URL || 'https://yourapp.com'
        }/products`,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@yourapp.com',
      });

      await this.dispatch({
        to,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'Our Platform'}!`,
        html,
      });

      this.logger.log('✅ Customer welcome email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send customer welcome email:', error);
      throw error;
    }
  }

  /**
   * Shared shape for both order emails, so the customer's copy and the
   * vendor's cannot drift on the figures they quote.
   */
  private orderEmailFields(order: {
    reference?: string;
    total?: number;
    items?: unknown[];
    createdAt?: Date | string;
  }) {
    const itemCount = order.items?.length ?? 0;
    return {
      orderReference: order.reference ?? '—',
      orderTotal: `₦${Number(order.total ?? 0).toLocaleString('en-NG')}`,
      itemCount,
      singleItem: itemCount === 1,
      orderDate: new Date(order.createdAt ?? Date.now()).toLocaleDateString(
        'en-NG',
        { day: 'numeric', month: 'long', year: 'numeric' },
      ),
      companyName: process.env.COMPANY_NAME || 'Qlozet',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@qlozet.app',
    };
  }

  /**
   * The order confirmation a customer expects within seconds of paying.
   *
   * Its absence is what produces "did my order go through?" - the customer
   * has no record and no reference to quote back at us.
   */
  async sendOrderConfirmationEmail(
    to: string,
    customerName: string,
    order: any,
    options: { multipleVendors?: boolean } = {},
  ) {
    try {
      if (!this.templates.orderConfirmation)
        throw new Error('Order confirmation template not loaded');

      const fields = this.orderEmailFields(order);
      const html = this.templates.orderConfirmation({
        ...fields,
        customerName,
        multipleVendors: options.multipleVendors ?? false,
        subject: `Order ${fields.orderReference} confirmed`,
        orderUrl: `${process.env.FRONTEND_URL || 'https://qlozet.app'}/profile?tab=orders`,
      });

      await this.dispatch({
        to,
        subject: `Order ${fields.orderReference} confirmed`,
        html,
      });
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send order confirmation email:', error);
      throw error;
    }
  }

  /**
   * Tells a vendor an order is waiting.
   *
   * The agreement gives them 48 hours to confirm, and until now the only
   * notice was a bell in a dashboard they might not open that day - a
   * deadline enforced without ever being announced.
   */
  async sendNewOrderVendorEmail(
    to: string,
    vendorName: string,
    businessName: string,
    order: any,
  ) {
    try {
      if (!this.templates.newOrderVendor)
        throw new Error('New order vendor template not loaded');

      const fields = this.orderEmailFields(order);
      const html = this.templates.newOrderVendor({
        ...fields,
        vendorName,
        businessName,
        subject: `New order ${fields.orderReference} — confirm within 48 hours`,
        orderUrl: `${
          process.env.VENDOR_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet.app'
        }/orders`,
      });

      await this.dispatch({
        to,
        subject: `New order ${fields.orderReference} — confirm within 48 hours`,
        html,
      });
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send new order vendor email:', error);
      throw error;
    }
  }

  /** Tells a customer their order has left the maker. */
  async sendOrderShippedEmail(
    to: string,
    customerName: string,
    order: any,
    trackingNumber?: string,
  ) {
    try {
      if (!this.templates.orderShipped)
        throw new Error('Order shipped template not loaded');

      const fields = this.orderEmailFields(order);
      const html = this.templates.orderShipped({
        ...fields,
        customerName,
        // Couriers do not always give one, and an empty box reads as an
        // error - the template drops the block entirely instead.
        trackingNumber: trackingNumber || '',
        subject: `Order ${fields.orderReference} is on its way`,
        orderUrl: `${process.env.FRONTEND_URL || 'https://qlozet.app'}/profile?tab=orders`,
      });

      await this.dispatch({
        to,
        subject: `Order ${fields.orderReference} is on its way`,
        html,
      });
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send order shipped email:', error);
      throw error;
    }
  }

  /**
   * Tells a customer their order arrived.
   *
   * Deliberately asks for problems before it asks for a review. Funds are
   * still held at this point and the return window is open, so this is the
   * moment a complaint is cheapest to resolve - for the customer and for us.
   */
  async sendOrderDeliveredEmail(to: string, customerName: string, order: any) {
    try {
      if (!this.templates.orderDelivered)
        throw new Error('Order delivered template not loaded');

      const fields = this.orderEmailFields(order);
      const html = this.templates.orderDelivered({
        ...fields,
        customerName,
        subject: `Order ${fields.orderReference} delivered`,
        orderUrl: `${process.env.FRONTEND_URL || 'https://qlozet.app'}/profile?tab=orders`,
      });

      await this.dispatch({
        to,
        subject: `Order ${fields.orderReference} delivered`,
        html,
      });
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send order delivered email:', error);
      throw error;
    }
  }

  /**
   * Tells a vendor their earnings have been released.
   *
   * People want to hear when money moves, and until now this only appeared
   * as a bell in a dashboard - so a vendor learned about their own payout by
   * going looking for it.
   */
  async sendPayoutReleasedEmail(
    to: string,
    vendorName: string,
    amount: number,
    orderReference?: string,
  ) {
    try {
      if (!this.templates.payoutReleased)
        throw new Error('Payout released template not loaded');

      const formatted = `₦${Number(amount ?? 0).toLocaleString('en-NG')}`;
      const html = this.templates.payoutReleased({
        vendorName,
        amount: formatted,
        orderReference: orderReference || '',
        companyName: process.env.COMPANY_NAME || 'Qlozet',
        subject: `${formatted} released to your wallet`,
        walletUrl: `${
          process.env.VENDOR_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet.app'
        }/wallet`,
      });

      await this.dispatch({
        to,
        subject: `${formatted} released to your wallet`,
        html,
      });
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send payout released email:', error);
      throw error;
    }
  }

  /**
   * The outcome of a moderation decision.
   *
   * One template for both, because the rejection is the half that matters and
   * splitting them invites the approval to be written carefully while the
   * rejection is an afterthought. A rejected listing says what was wrong and
   * that nothing was deleted - a vendor who cannot tell why, or thinks their
   * work is gone, writes to support instead of fixing it.
   */
  async sendProductModeratedEmail(
    to: string,
    vendorName: string,
    productName: string,
    approved: boolean,
    reason?: string,
  ) {
    try {
      if (!this.templates.productModerated)
        throw new Error('Product moderated template not loaded');

      const subject = approved
        ? `${productName} approved`
        : `${productName} needs changes before it can go live`;

      const html = this.templates.productModerated({
        vendorName,
        productName,
        approved,
        reason: reason?.trim() || 'No reason was given.',
        companyName: process.env.COMPANY_NAME || 'Qlozet',
        subject,
        productsUrl: `${
          process.env.VENDOR_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet.app'
        }/products`,
      });

      await this.dispatch({ to, subject, html });
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send product moderated email:', error);
      throw error;
    }
  }

  async sendTeamInviteEmail(
    to: string,
    name: string,
    role: string,
    businessName: string,
    temporaryPassword: string,
  ) {
    try {
      if (!this.templates.inviteUser)
        throw new Error('Team invite template not loaded');

      const html = this.templates.inviteUser({
        userName: name,
        email: to,
        role,
        companyName: businessName,
        temporaryPassword,
        loginUrl: `${process.env.VENDOR_FRONTEND_URL || process.env.FRONTEND_URL || 'https://qlozet-vert.vercel.app'}/auth/sign-in`,
        supportEmail: process.env.SUPPORT_EMAIL || 'support@qoobea.com',
      });

      await this.dispatch({
        to,
        subject: `Welcome to ${businessName} on Qlozet!`,
        html,
      });

      this.logger.log('✅ Team invite email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send team invite email:', error);
      throw error;
    }
  }

  // For an EXISTING Qlozet user added to a vendor team: no temporary password —
  // they sign in with their own credentials. (Sending a temp password here would
  // be both wrong, since it's never saved, and insecure, since it would reset a
  // real account's login.)
  async sendTeamAddedEmail(
    to: string,
    name: string,
    role: string,
    businessName: string,
  ) {
    try {
      if (!this.templates.teamAdded)
        throw new Error('Team added template not loaded');

      const subject = `You have been added to ${businessName} on Qlozet`;
      const html = this.templates.teamAdded({
        name,
        role,
        businessName,
        subject,
        preheader: `Sign in with your existing password to join ${businessName}.`,
        loginUrl: `${
          process.env.VENDOR_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet.app'
        }/auth/sign-in`,
      });

      await this.dispatch({ to, subject, html });
      return true;
    } catch (error) {
      this.logger.error('Failed to send team added email', error as any);
      throw error;
    }
  }

  /**
   * A brand-new PLATFORM administrator's credentials.
   *
   * The vendor twin above needs a business name and points at the vendor app;
   * an admin belongs to Qlozet itself and signs in to the console, so neither
   * fits. Inline HTML rather than a template file, like sendTeamAddedEmail.
   */
  async sendAdminInviteEmail(
    to: string,
    name: string,
    role: string,
    temporaryPassword: string,
    invitedBy?: string,
  ) {
    try {
      if (!this.templates.adminInvite)
        throw new Error('Admin invite template not loaded');

      const subject = 'Your Qlozet admin account';
      const html = this.templates.adminInvite({
        name,
        email: to,
        temporaryPassword,
        invitedBy,
        roleLabel: role.replace(/[_-]+/g, ' '),
        subject,
        preheader: 'Your admin sign-in details are inside.',
        loginUrl: `${
          process.env.ADMIN_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet-admin.vercel.app'
        }/login`,
      });

      await this.dispatch({ to, subject, html });
      return true;
    } catch (error) {
      this.logger.error('Failed to send admin invite email', error as any);
      throw error;
    }
  }

  // ================================================================
  // BESPOKE QUOTE EMAIL METHODS
  // ================================================================

  async sendQuoteRequestEmail(
    to: string,
    vendorName: string,
    designName: string,
    designImages: string[] = [],
  ) {
    try {
      if (!this.templates.quoteRequest)
        throw new Error('Quote request template not loaded');

      const subject = `New bespoke quote request: ${designName}`;
      const html = this.templates.quoteRequest({
        vendorName,
        designName,
        designImage: designImages?.[0] || '',
        subject,
        preheader: `${designName} — you have 7 days to quote.`,
        quotesUrl: `${
          process.env.VENDOR_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet.app'
        }/vendor/bespoke/quotes`,
      });

      await this.dispatch({ to, subject, html });
      return true;
    } catch (error) {
      this.logger.error('Failed to send quote request email', error as any);
      throw error;
    }
  }

  async sendQuoteSubmittedEmail(
    to: string,
    customerName: string,
    vendorName: string,
    total: number,
    estimatedDays?: number,
  ) {
    try {
      if (!this.templates.quoteSubmitted)
        throw new Error('Quote submitted template not loaded');

      const formattedTotal = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
        maximumFractionDigits: 0,
      }).format(Number(total ?? 0));

      const subject = `Quote received from ${vendorName}`;
      const html = this.templates.quoteSubmitted({
        customerName,
        vendorName,
        total: formattedTotal,
        estimatedDays,
        singleDay: estimatedDays === 1,
        subject,
        preheader: `${vendorName} quoted ${formattedTotal} for your design.`,
        bespokeUrl: `${process.env.FRONTEND_URL || 'https://qlozet.app'}/bespoke`,
      });

      await this.dispatch({ to, subject, html });
      return true;
    } catch (error) {
      this.logger.error('Failed to send quote submitted email', error as any);
      throw error;
    }
  }

  async sendQuoteRevisionEmail(
    to: string,
    vendorName: string,
    designName: string,
    revisionMessage: string,
  ) {
    try {
      if (!this.templates.quoteRevision)
        throw new Error('Quote revision template not loaded');

      const subject = `Revision requested on your quote for ${designName}`;
      const html = this.templates.quoteRevision({
        vendorName,
        designName,
        revisionMessage,
        subject,
        preheader: 'The customer has asked for a change before deciding.',
        quotesUrl: `${
          process.env.VENDOR_FRONTEND_URL ||
          process.env.FRONTEND_URL ||
          'https://qlozet.app'
        }/vendor/bespoke/quotes`,
      });

      await this.dispatch({ to, subject, html });
      return true;
    } catch (error) {
      this.logger.error('Failed to send quote revision email', error as any);
      throw error;
    }
  }

  areTemplatesLoaded(): boolean {
    return !!(
      this.templates.verification &&
      this.templates.passwordReset &&
      this.templates.passwordResetSuccess &&
      this.templates.passwordUpdated &&
      this.templates.vendorWelcome &&
      this.templates.customerWelcome
    );
  }
}
