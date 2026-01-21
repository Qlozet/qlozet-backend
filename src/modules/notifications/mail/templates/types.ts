export interface EmailTemplateData {
  subject: string;
  previewText?: string;
  userName?: string;
  actionUrl?: string;
  supportEmail?: string;
  companyName?: string;
  companyAddress?: string;
  companyLogoUrl?: string;
  websiteUrl?: string;
}

export interface EmailVerificationData extends EmailTemplateData {
  verificationCode?: string;
  verificationUrl?: string;
  expiryTime?: string;
}

export interface PasswordResetData extends EmailTemplateData {
  resetUrl?: string;
  expiryTime?: string;
  ipAddress?: string;
  browserInfo?: string;
}

export interface EmailConfig {
  from: string;
  subject: string;
  template: string;
  data: EmailTemplateData;
}

export interface EmailService {
  sendEmail(to: string, config: EmailConfig): Promise<void>;
}
