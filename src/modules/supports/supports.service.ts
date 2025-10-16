import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Axios from 'axios';
import { CreateTicketDto } from './dto/create-ticket.dto';
import zohoConfig from '../../common/config/zoho.config';
import { ZohoToken, ZohoTokenDocument } from './schema/zoho-token.schema';
import {
  Support,
  SupportDocument,
  SupportSchema,
} from './schema/support.schema';

function addMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectModel(ZohoToken.name)
    private readonly zohoTokenModel: Model<ZohoTokenDocument>,
    @InjectModel(Support.name)
    private readonly supportModel: Model<SupportDocument>,
  ) {}

  /** Save or update Zoho token */
  private async saveToken(dto: Partial<ZohoToken>): Promise<ZohoToken> {
    const existing = await this.zohoTokenModel.findOne();

    if (existing) {
      const updated = await this.zohoTokenModel.findByIdAndUpdate(
        existing._id,
        dto,
        {
          new: true,
        },
      );
      if (!updated) {
        throw new InternalServerErrorException('Failed to update Zoho token.');
      }

      return updated;
    }

    const created = await this.zohoTokenModel.create(dto);
    if (!created) {
      throw new InternalServerErrorException('Failed to create Zoho token.');
    }

    return created;
  }

  /** Generate a new token using authorization code */
  async generateToken(code?: string): Promise<ZohoToken> {
    try {
      console.log(zohoConfig.baseUrl);
      const { data } = await Axios.post(
        `${zohoConfig.baseUrl}/v2/token`,
        null,
        {
          params: {
            client_id: zohoConfig.clientID,
            client_secret: zohoConfig.clientSecret,
            grant_type: 'authorization_code',
            code: code,
          },
        },
      );
      const newToken = await this.saveToken({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: addMinutes(55),
      });

      return newToken;
    } catch (error) {
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        'Token generation failed';
      this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /** Refresh token when expired */
  async refreshToken(refresh_token: string): Promise<ZohoToken> {
    try {
      const { data } = await Axios.post(
        `${zohoConfig.baseUrl}/v2/token`,
        null,
        {
          params: {
            client_id: zohoConfig.clientID,
            client_secret: zohoConfig.clientSecret,
            grant_type: 'refresh_token',
            refresh_token,
            scope: zohoConfig.scope,
          },
        },
      );

      const updatedToken = await this.saveToken({
        access_token: data.access_token,
        refresh_token: data.refresh_token ?? refresh_token,
        expires_at: addMinutes(55),
      });

      return updatedToken;
    } catch (error) {
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        'Token refresh failed';
      this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }
  }

  /** Get current stored token */
  private async getToken(): Promise<ZohoToken | null> {
    return await this.zohoTokenModel.findOne();
  }

  /** Ensure token is valid (auto-refresh if expired) */
  private async getValidToken(): Promise<ZohoToken> {
    const token = await this.getToken();

    if (!token) {
      this.logger.warn('No existing Zoho token found. Generating new one...');
      return this.generateToken();
    }

    if (Date.now() > token.expires_at.getTime()) {
      this.logger.log('Zoho token expired. Refreshing...');
      return this.refreshToken(token.refresh_token);
    }

    return token;
  }

  /** Create Zoho support ticket */
  async createTicket(dto: CreateTicketDto, business: string): Promise<any> {
    try {
      const token = await this.getValidToken();

      const ticketData = {
        email: dto.email,
        subject: dto.subject,
        description: dto.message,
        departmentId: process.env.ZOHO_DEPARTMENT_ID,
        contact: {
          firstName: dto.first_name,
          lastName: dto.last_name,
          email: dto.email,
          phone: dto.phone_number,
        },
      };

      const { data } = await Axios.post(zohoConfig.tickets, ticketData, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      const support = new this.supportModel({
        first_name: dto.first_name,
        last_name: dto.last_name,
        email: dto.email,
        message: dto.message,
        subject: dto.subject,
        phone_number: dto.phone_number,
        business,
        zoho_ticket_id: data.id,
      });
      await support.save();

      return support.toJSON();
    } catch (error) {
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        'Ticket creation failed';
      this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }
  }
  async getTicketsByBusiness(businessId: string): Promise<Support[]> {
    try {
      return this.supportModel
        .find({ business: businessId })
        .sort({ createdAt: -1 })
        .lean()
        .exec();
    } catch (error) {
      this.logger.error(
        `Failed to fetch tickets for business ${businessId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'Could not retrieve support tickets',
      );
    }
  }
}
