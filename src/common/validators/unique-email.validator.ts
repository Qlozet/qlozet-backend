import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Injectable()
@ValidatorConstraint({ name: 'uniqueBusinessEmail', async: true })
export class UniqueBusinessEmailValidator
  implements ValidatorConstraintInterface
{
  constructor(@InjectModel('Vendor') private vendorModel: Model<any>) {}

  async validate(email: string, args: ValidationArguments) {
    const existingVendor = await this.vendorModel.findOne({
      businessEmail: email,
    });
    return !existingVendor;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Business email is already registered';
  }
}

@Injectable()
@ValidatorConstraint({ name: 'uniqueCustomerEmail', async: true })
export class UniqueCustomerEmailValidator
  implements ValidatorConstraintInterface
{
  constructor(@InjectModel('User') private userModel: Model<any>) {}

  async validate(email: string, args: ValidationArguments) {
    const existingUser = await this.userModel.findOne({ email });
    return !existingUser;
  }

  defaultMessage(args: ValidationArguments) {
    return 'Email is already registered';
  }
}
