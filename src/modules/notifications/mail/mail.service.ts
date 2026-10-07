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
        to: message.to,
        subject: message.subject,
        status,
        error: error ?? null,
      });
    } catch (err: any) {
      this.logger.warn(`Could not record email attempt: ${err?.message}`);
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

    return {
      ...customData,
      year: currentYear,
      websiteUrl: process.env.FRONTEND_URL || 'https://yourapp.com',
      companyName: process.env.COMPANY_NAME || 'Your App',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@yourapp.com',
      companyAddress:
        process.env.COMPANY_ADDRESS || '123 Business St, City, State 12345',
      companyLogoUrl:
        process.env.COMPANY_LOGO_URL ||
        'https://via.placeholder.com/180x60/667eea/ffffff?text=LOGO',
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
      const loginUrl = `${process.env.VENDOR_FRONTEND_URL || process.env.FRONTEND_URL || 'https://qlozet-vert.vercel.app'}/auth/sign-in`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2C1810;">
          <h2 style="color: #2C1810;">You've been added to ${businessName}</h2>
          <p>Hello <strong>${name}</strong>,</p>
          <p>You've been added to <strong>${businessName}</strong> on Qlozet as a <strong>${role}</strong>.</p>
          <p>Because you already have a Qlozet account, just sign in with your <strong>existing email and password</strong> — no new password is needed. After signing in you can switch to ${businessName}.</p>
          <p style="margin:22px 0;">
            <a href="${loginUrl}" target="_blank"
               style="display:inline-block;background:#2C1810;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">Sign in</a>
          </p>
          <p style="color:#8A7C6E;font-size:13px;">Forgot your password? Use "Forgot password" on the sign-in page.</p>
        </div>`;
      await this.dispatch({
        to,
        subject: `You've been added to ${businessName} on Qlozet`,
        html,
      });
      this.logger.log('✅ Team added email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send team added email:', error);
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
      const loginUrl = `${process.env.ADMIN_FRONTEND_URL || process.env.FRONTEND_URL || 'https://qlozet-admin.vercel.app'}/login`;
      const roleLabel = role.replace(/[_-]+/g, ' ');
      const invitedLine = invitedBy
        ? `<p><strong>${invitedBy}</strong> added you to the Qlozet admin console.</p>`
        : `<p>You have been added to the Qlozet admin console.</p>`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #2C1810;">
          <h2 style="color: #2C1810;">Welcome to the Qlozet admin console</h2>
          <p>Hello <strong>${name}</strong>,</p>
          ${invitedLine}
          <p>Your role is <strong>${roleLabel}</strong>.</p>
          <p>Sign in with the credentials below, then change your password from your profile.</p>
          <div style="background:#F7F4F1;border-radius:10px;padding:16px;margin:18px 0;">
            <p style="margin:0 0 6px;"><strong>Email:</strong> ${to}</p>
            <p style="margin:0;"><strong>Temporary password:</strong> ${temporaryPassword}</p>
          </div>
          <p style="margin:22px 0;">
            <a href="${loginUrl}" target="_blank"
               style="display:inline-block;background:#2C1810;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600;">Sign in</a>
          </p>
          <p style="color:#8A7C6E;font-size:13px;">If you were not expecting this, contact ${process.env.SUPPORT_EMAIL || 'support@qoobea.com'}.</p>
        </div>`;

      await this.dispatch({
        to,
        subject: 'Your Qlozet admin account',
        html,
      });

      this.logger.log('✅ Admin invite email sent successfully to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send admin invite email:', error);
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
    designImages: string[],
  ) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C1810;">New Bespoke Quote Request</h2>
          <p>Hello <strong>${vendorName}</strong>,</p>
          <p>A customer has requested a quote for their bespoke design: <strong>${designName}</strong>.</p>
          ${designImages.length > 0 ? `<p><img src="${designImages[0]}" alt="Design" style="max-width: 300px; border-radius: 12px;" /></p>` : ''}
          <p>You have <strong>7 days</strong> to submit your quote before it expires.</p>
          <p>Log in to your vendor dashboard to review the design details and submit your quote.</p>
          <a href="${process.env.FRONTEND_URL || 'https://qlozet.app'}/vendor/bespoke/quotes" 
             style="display: inline-block; padding: 12px 24px; background: #2C1810; color: #fff; text-decoration: none; border-radius: 8px; margin-top: 12px;">
            View Quote Request
          </a>
          <p style="margin-top: 24px; color: #888; font-size: 12px;">
            Custom orders become non-cancellable after cutting begins.
          </p>
        </div>
      `;

      await this.dispatch({
        to,
        subject: `New Bespoke Quote Request: ${designName}`,
        html,
      });

      this.logger.log('✅ Quote request email sent to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send quote request email:', error);
      throw error;
    }
  }

  async sendQuoteSubmittedEmail(
    to: string,
    customerName: string,
    vendorName: string,
    total: number,
    estimatedDays: number,
  ) {
    try {
      const formattedTotal = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: 'NGN',
      }).format(total);

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C1810;">Quote Received!</h2>
          <p>Hello <strong>${customerName}</strong>,</p>
          <p><strong>${vendorName}</strong> has submitted a quote for your bespoke design.</p>
          <div style="background: #F9F7F4; padding: 16px; border-radius: 12px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Total:</strong> ${formattedTotal}</p>
            <p style="margin: 4px 0;"><strong>Estimated completion:</strong> ${estimatedDays} days</p>
          </div>
          <p>Log in to review and compare quotes for your design.</p>
          <a href="${process.env.FRONTEND_URL || 'https://qlozet.app'}/bespoke" 
             style="display: inline-block; padding: 12px 24px; background: #2C1810; color: #fff; text-decoration: none; border-radius: 8px; margin-top: 12px;">
            View Quotes
          </a>
        </div>
      `;

      await this.dispatch({
        to,
        subject: `Quote received from ${vendorName}`,
        html,
      });

      this.logger.log('✅ Quote submitted email sent to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send quote submitted email:', error);
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
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2C1810;">Revision Requested</h2>
          <p>Hello <strong>${vendorName}</strong>,</p>
          <p>A customer has requested a revision on your quote for <strong>${designName}</strong>.</p>
          <div style="background: #FFF3CD; padding: 16px; border-radius: 12px; margin: 16px 0; border-left: 4px solid #D97706;">
            <p style="font-style: italic; margin: 0;">"${revisionMessage}"</p>
          </div>
          <p>Please update your quote and resubmit.</p>
          <a href="${process.env.FRONTEND_URL || 'https://qlozet.app'}/vendor/bespoke/quotes" 
             style="display: inline-block; padding: 12px 24px; background: #2C1810; color: #fff; text-decoration: none; border-radius: 8px; margin-top: 12px;">
            Update Quote
          </a>
        </div>
      `;

      await this.dispatch({
        to,
        subject: `Revision requested: ${designName}`,
        html,
      });

      this.logger.log('✅ Quote revision email sent to:', to);
      return true;
    } catch (error) {
      this.logger.error('❌ Failed to send quote revision email:', error);
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
