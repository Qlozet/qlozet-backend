import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Waitlist, WaitlistDocument, WaitlistType } from './schema/waitlist.schema';
import { CustomerWaitlistDto, VendorWaitlistDto } from './dto/waitlist.dto';

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectModel(Waitlist.name) private waitlistModel: Model<WaitlistDocument>,
  ) {}

  async joinCustomerWaitlist(dto: CustomerWaitlistDto) {
    try {
      const existing = await this.waitlistModel.findOne({ email: dto.email });
      if (existing) {
        // Return success even if they already joined to avoid leaking emails
        return { message: 'Successfully joined the customer waitlist!' };
      }

      await this.waitlistModel.create({
        type: WaitlistType.CUSTOMER,
        fullName: dto.fullName,
        email: dto.email,
      });

      return { message: 'Successfully joined the customer waitlist!' };
    } catch (error) {
      this.logger.error(`Error joining customer waitlist: ${error.message}`);
      throw error;
    }
  }

  async joinVendorWaitlist(dto: VendorWaitlistDto) {
    try {
      const existing = await this.waitlistModel.findOne({ email: dto.businessEmail });
      if (existing) {
        return { message: 'Successfully joined the vendor waitlist!' };
      }

      await this.waitlistModel.create({
        type: WaitlistType.VENDOR,
        fullName: dto.fullName,
        email: dto.businessEmail, // mapping businessEmail to the schema's email field
        businessName: dto.businessName,
        phoneNumber: dto.phoneNumber,
        businessType: dto.businessType,
      });

      return { message: 'Successfully joined the vendor waitlist!' };
    } catch (error) {
      this.logger.error(`Error joining vendor waitlist: ${error.message}`);
      throw error;
    }
  }
}
