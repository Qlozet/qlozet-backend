import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
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
}

@Injectable()
export class MailService {
  private templates: Partial<EmailTemplates> = {};

  constructor(private readonly mailerService: MailerService) {
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
      console.log('📂 Using local template path:', localSrcPath);
      return localSrcPath;
    }
    if (fs.existsSync(distPath)) {
      console.log('📂 Using dist template path:', distPath);
      return distPath;
    }
    if (fs.existsSync(altDistPath)) {
      console.log('📂 Using alt dist template path:', altDistPath);
      return altDistPath;
    }
    if (fs.existsSync(dockerDistPath)) {
      console.log('📂 Using docker dist template path:', dockerDistPath);
      return dockerDistPath;
    }

    console.warn('⚠️ No valid templates directory found.');
    return localSrcPath; // fallback
  }

  private async initializeTemplates() {
    try {
      console.log('🟡 Initializing email templates...');
      await this.registerPartials();

      this.templates = {
        verification: await this.loadTemplate('email-verification'),
        passwordReset: await this.loadTemplate('password-reset-request'),
        passwordResetSuccess: await this.loadTemplate('password-reset-success'),
        passwordUpdated: await this.loadTemplate('password-updated'),
        vendorWelcome: await this.loadTemplate('vendor-welcome'),
        customerWelcome: await this.loadTemplate('customer-welcome'),
        inviteUser: await this.loadTemplate('invite-user'),
      };

      console.log('✅ All email templates initialized successfully!');
    } catch (error) {
      console.error('❌ Failed to initialize email templates:', error);
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
          console.log(`✅ Registered partial: ${partialName}`);
        }
      }

      console.log('🎉 All partials registered successfully!');
    } catch (error: any) {
      console.warn('⚠️ Could not load email partials:', error.message);
      console.log('Partials directory attempted:', partialsDir);
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
        console.warn(`⚠️ No partials found in ${partialsDir}`);
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
      console.error(`❌ Failed to load template: ${templateName}`, error);
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

      await this.mailerService.sendMail({
        to,
        subject: 'Verify Your Email Address',
        html,
      });

      console.log('✅ Verification email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send verification email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: 'Your Password Reset Code',
        html,
      });

      console.log('✅ Password reset code email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send password reset code email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: 'Password Reset Successful',
        html,
      });

      console.log('✅ Password reset success email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send password reset success email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: 'Password Updated Successfully',
        html,
      });

      console.log('✅ Password updated email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send password updated email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'Our Platform'}!`,
        html,
      });

      console.log('✅ Vendor welcome email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send vendor welcome email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: `Welcome to ${process.env.COMPANY_NAME || 'Our Platform'}!`,
        html,
      });

      console.log('✅ Customer welcome email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send customer welcome email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: `Welcome to ${businessName} on Qlozet!`,
        html,
      });

      console.log('✅ Team invite email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send team invite email:', error);
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
      await this.mailerService.sendMail({
        to,
        subject: `You've been added to ${businessName} on Qlozet`,
        html,
      });
      console.log('✅ Team added email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send team added email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: `New Bespoke Quote Request: ${designName}`,
        html,
      });

      console.log('✅ Quote request email sent to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send quote request email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: `Quote received from ${vendorName}`,
        html,
      });

      console.log('✅ Quote submitted email sent to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send quote submitted email:', error);
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

      await this.mailerService.sendMail({
        to,
        subject: `Revision requested: ${designName}`,
        html,
      });

      console.log('✅ Quote revision email sent to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send quote revision email:', error);
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
