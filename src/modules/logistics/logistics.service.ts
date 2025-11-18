import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosResponse } from 'axios';
import {
  ShipmentPayload,
  ShipmentResponse,
  FetchRatePayload,
  FetchRateResponse,
  AddressDetails,
  ValidatedAddressResponseDto,
} from './dto/shipping.dto';

@Injectable()
export class LogisticsService {
  private readonly baseUrl = process.env.SHIPBUBBLE_BASE_URL;
  private readonly token = process.env.SHIPBUBBLE_API_KEY;

  constructor(private readonly httpService: HttpService) {
    if (!this.baseUrl) throw new Error('SHIPBUBBLE_URL is required');
    if (!this.token) throw new Error('SHIPBUBBLE_TOKEN is required');
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  private buildUrl(endpoint: string) {
    return `${this.baseUrl}/v1/${endpoint.replace(/^\/+/, '')}`;
  }

  async validateAddress(
    address: AddressDetails,
  ): Promise<ValidatedAddressResponseDto> {
    try {
      const response: AxiosResponse<{ data: ValidatedAddressResponseDto }> =
        await firstValueFrom(
          this.httpService.post(
            this.buildUrl('/shipping/address/validate'),
            address,
            { headers: this.headers },
          ),
        );

      return response?.data?.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.message || error.message,
        error.response?.status || 500,
      );
    }
  }

  async getPackageDimension(): Promise<any> {
    try {
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(this.buildUrl('/shipping/labels/boxes'), {
          headers: this.headers,
        }),
      );

      return response.data?.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message,
        error.response?.status || 500,
      );
    }
  }

  async getCouriers(): Promise<any> {
    try {
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(this.buildUrl('/shipping/couriers'), {
          headers: this.headers,
        }),
      );
      const couriersData = response.data?.data;
      if (!couriersData) return [];

      const couriersArray = Object.keys(couriersData).map(
        (key) => couriersData[key],
      );
      return couriersArray;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message,
        error.response?.status || 500,
      );
    }
  }

  async fetchRates(
    serviceCodes: string[],
    payload: FetchRatePayload,
  ): Promise<FetchRateResponse> {
    try {
      const response: AxiosResponse<{ data: FetchRateResponse }> =
        await firstValueFrom(
          this.httpService.post(
            this.buildUrl(`/shipping/fetch_rates/${serviceCodes.join(',')}`),
            payload,

            { headers: this.headers },
          ),
        );
      return response?.data?.data;
    } catch (error: any) {
      console.log(error.response?.status);
      throw new HttpException(
        error.response?.data || error.message,
        error.response?.status || 500,
      );
    }
  }

  async createShipment(payload: FetchRatePayload): Promise<ShipmentResponse> {
    try {
      const service_code = process.env.SERVICE_CODE as string;
      const rate = await this.fetchRates([service_code], payload);

      const response: AxiosResponse<ShipmentResponse> = await firstValueFrom(
        this.httpService.post(
          this.buildUrl('/shipping/labels'),
          {
            request_token: rate.request_token,
            service_code: service_code,
            courier_id: rate.fastest_courier.courier_id,
            insurance_code: rate.fastest_courier.insurance.code,
          },
          { headers: this.headers },
        ),
      );
      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message,
        error.response?.status || 500,
      );
    }
  }

  async cancelShipment(orderId: string): Promise<any> {
    try {
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.post(
          this.buildUrl(`/shipping/labels/cancel/${orderId}`),
          { order_id: orderId },
          { headers: this.headers },
        ),
      );
      return response.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data || error.message,
        error.response?.status || 500,
      );
    }
  }
}
