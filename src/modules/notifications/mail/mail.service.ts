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

  async sendResetEmail(to: string, name: string, resetLink: string) {
    try {
      if (!this.templates.passwordReset)
        throw new Error('Password reset template not loaded');

      const html = this.templates.passwordReset({
        userName: name,
        resetUrl: resetLink,
        expiryTime: '1 hour',
        subject: 'Reset Your Password',
      });

      await this.mailerService.sendMail({
        to,
        subject: 'Reset Your Password',
        html,
      });

      console.log('✅ Password reset email sent successfully to:', to);
      return true;
    } catch (error) {
      console.error('❌ Failed to send password reset email:', error);
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
        role,
        companyName: businessName,
        temporaryPassword,
        loginUrl: `${process.env.FRONTEND_URL || 'https://qoobea.com'}/login`,
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
