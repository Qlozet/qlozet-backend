import { UserDocument } from '../../modules/ums/schemas';

/**
 * Sanitize user object - remove sensitive fields
 */
export const sanitizeUser = (user: UserDocument) => {
  const userObj = user.toObject();
  delete userObj.hashed_password;
  delete userObj.email_verification_token;
  delete userObj.email_verification_expires;
  delete userObj.refreshToken;
  delete userObj.verification;
  delete userObj.passwordResetCode;

  return userObj;
};
export const sanitizeBusiness = (business: any) => ({
  _id: business._id,
  business_name: business.business_name,
  business_email: business.business_email,
  business_phone_number: business.business_phone_number,
  display_picture_url: business.display_picture_url,
  business_logo_url: business.business_logo_url,
  cover_image_url: business.cover_image_url,
  status: business.status,
  country: business.country,
  state: business.state,
  city: business.city,
  is_active: business.is_active,
  createdAt: business.createdAt,
});
