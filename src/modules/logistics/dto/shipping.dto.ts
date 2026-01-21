import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ValidatedAddressResponseDto {
  @ApiProperty({ example: 'Lebron James' })
  name: string;

  @ApiProperty({ example: 'lebron@james.com' })
  email: string;

  @ApiProperty({ example: '+2348057575855' })
  phone: string;

  @ApiProperty({
    example: '15 Babatunde Jose St, Victoria Island 106104, Lagos, Nigeria',
  })
  formatted_address: string;

  @ApiProperty({ example: 'Nigeria' })
  country: string;

  @ApiProperty({ example: 'NG' })
  country_code: string;

  @ApiProperty({ example: 'Lagos' })
  city: string;

  @ApiProperty({ example: 'Lagos' })
  city_code: string;

  @ApiProperty({ example: 'Lagos' })
  state: string;

  @ApiProperty({ example: 'LA' })
  state_code: string;

  @ApiProperty({ example: '106104' })
  postal_code: string;

  @ApiProperty({ example: 6.436058 })
  latitude: number;

  @ApiProperty({ example: 3.433361 })
  longitude: number;

  @ApiProperty({ example: 98794022 })
  address_code: number;
}

export class AddressDetails {
  @ApiProperty({ example: 'John Doe' })
  name: string;

  @ApiProperty({ example: '+2348012345678' })
  phone: string;

  @ApiProperty({ required: false, example: 'john@example.com' })
  email?: string;

  @ApiProperty({ example: '123 Main St' })
  address: string;

  @ApiProperty({ example: 'Lagos' })
  city: string;

  @ApiProperty({ example: 'Lagos' })
  state: string;

  @ApiProperty({ example: 'Nigeria' })
  country: string;

  @ApiProperty({ required: false, example: '100001' })
  postal_code?: string;

  @ApiProperty({ example: 6.572255 })
  latitude: number;

  @ApiProperty({ example: 3.357948 })
  longitude: number;
}

// ======================
// Package DTO
// ======================
export class PackageItem {
  @ApiProperty({ example: 'Laptop' })
  name: string;

  @ApiProperty({ example: '15-inch MacBook Pro' })
  description: string;

  @ApiProperty({ example: 2.5, description: 'Weight in kg' })
  unit_weight: number;

  @ApiProperty({ example: 250000 })
  unit_amount: number;
  @ApiProperty({ example: 1 })
  quantity: number;
}

// ======================
// Shipment Payload (Create Shipment)
// ======================
export class ShipmentPayload {
  @ApiProperty({ type: AddressDetails })
  sender: AddressDetails;

  @ApiProperty({ type: AddressDetails })
  receiver: AddressDetails;

  @ApiProperty({
    description: 'List of packages',
    type: [PackageItem],
  })
  @Type(() => PackageItem)
  package_items: PackageItem[];

  @ApiProperty({ required: false, example: 'FastCourier' })
  courier?: string;

  @ApiProperty({ required: false, example: 'standard' })
  service_type?: string;

  @ApiProperty({ required: false, example: 'req_12345' })
  reference_id?: string;
}

// ======================
// Shipment Response
// ======================
export class ShipmentResponse {
  @ApiProperty({ example: 'shp_123456' })
  shipment_id: string;

  @ApiProperty({ example: 'TRK1234567890' })
  tracking_number: string;

  @ApiProperty({ example: 'FastCourier' })
  courier: string;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiProperty({ required: false, example: '2025-11-20' })
  estimated_delivery?: string;

  @ApiProperty({ example: '2025-11-15T20:00:00Z' })
  created_at: string;

  @ApiProperty({ required: false, example: 'https://example.com/label.pdf' })
  label_url?: string;
}

export class PackageDimensions {
  @ApiProperty({ example: 10 })
  length: number;

  @ApiProperty({ example: 15 })
  width: number;

  @ApiProperty({ example: 5 })
  height: number;
}
// ======================
// Fetch Rate Payload
// ======================
export class FetchRatePayload {
  @ApiProperty({ description: 'Sender address code', example: 98794022 })
  sender_address_code: number | string;

  @ApiProperty({ description: 'Receiver address code', example: 98794022 })
  reciever_address_code: number | string;

  @ApiProperty({
    description: 'Pickup date in YYYY-MM-DD format',
    example: '2025-11-16',
  })
  pickup_date: string;

  @ApiProperty({
    description: 'List of packages',
    type: [PackageItem],
  })
  @Type(() => PackageItem)
  package_items: PackageItem[];

  @ApiProperty({
    required: false,
    description: 'Service type',
    example: 'pickup',
  })
  service_type?: string;
  @ApiProperty({
    required: false,
    description: 'Package dimensions (cm)',
    type: PackageDimensions,
    example: { length: 10, width: 15, height: 5 },
  })
  package_dimension?: PackageDimensions;
}

export class Station {
  @ApiProperty()
  name: string;

  @ApiProperty()
  address: string;

  @ApiProperty()
  phone: string;
}

export class Insurance {
  @ApiProperty()
  code: string;

  @ApiProperty()
  fee: number;
}

export class Discount {
  @ApiProperty()
  percentage: number;

  @ApiProperty()
  symbol: string;

  @ApiProperty()
  discounted: number;
}

export class Tracking {
  @ApiProperty()
  bars: number;

  @ApiProperty()
  label: string;
}

export class Person {
  @ApiProperty()
  name: string;

  @ApiProperty()
  phone: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  address: string;
}

export class CheckoutData {
  @ApiProperty({ type: Person })
  ship_from: Person;

  @ApiProperty({ type: Person })
  ship_to: Person;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  package_amount: number;

  @ApiProperty()
  package_weight: number;

  @ApiProperty()
  pickup_date: string;

  @ApiProperty()
  is_invoice_required: boolean;
}

export class Rate {
  @ApiProperty()
  courier_id: string | number;

  @ApiProperty()
  courier_name: string;

  @ApiProperty()
  courier_image: string;

  @ApiProperty()
  service_code: string;

  @ApiProperty({ type: Insurance })
  insurance: Insurance;

  @ApiProperty({ type: Discount })
  discount: Discount;

  @ApiProperty()
  service_type: string;

  @ApiProperty()
  waybill: boolean;

  @ApiProperty()
  on_demand: boolean;

  @ApiProperty()
  is_cod_available: boolean;

  @ApiProperty({ required: false })
  cod_remit_days?: number;

  @ApiProperty()
  tracking_level: number;

  @ApiProperty()
  ratings: number;

  @ApiProperty()
  votes: number;

  @ApiProperty()
  connected_account: boolean;

  @ApiProperty()
  rate_card_amount: number;

  @ApiProperty()
  rate_card_currency: string;

  @ApiProperty()
  pickup_eta: string;

  @ApiProperty()
  pickup_eta_time: string;

  @ApiProperty({ nullable: true, type: Station })
  dropoff_station: Station | null;

  @ApiProperty({ nullable: true, type: Station })
  pickup_station: Station | null;

  @ApiProperty()
  delivery_eta: string;

  @ApiProperty()
  delivery_eta_time: string;

  @ApiProperty({ nullable: true })
  info: any;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  vat: number;

  @ApiProperty()
  total: number;

  @ApiProperty({ type: Tracking })
  tracking: Tracking;
}

export class FetchRateResponse {
  @ApiProperty()
  request_token: string;

  @ApiProperty({ type: [Rate] })
  couriers: Rate[];

  @ApiProperty({ type: Rate })
  fastest_courier: Rate;

  @ApiProperty({ type: Rate })
  cheapest_courier: Rate;

  @ApiProperty({ type: CheckoutData })
  checkout_data: CheckoutData;
}
