import { UserDocument } from '../../modules/ums/schemas';

export type JwtPayload = {
  id: any;
  email: string;
  role: any;
  type: string;
};
