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
