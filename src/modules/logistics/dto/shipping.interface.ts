export interface ShipmentPayload {
  sender: {
    name: string;
    phone: string;
    email?: string;
    address: string;
    city: string;
    state: string;
    country: string;
    postal_code?: string;
  };
  receiver: {
    name: string;
    phone: string;
    email?: string;
    address: string;
    city: string;
    state: string;
    country: string;
    postal_code?: string;
  };
  package: {
    weight: number; // in kg
    dimensions?: {
      length: number;
      width: number;
      height: number;
    };
    contents: string;
    quantity: number;
    value?: number; // in local currency
  };
  courier?: string; // optional: select a specific courier
  service_type?: string; // optional: e.g., "same-day", "standard"
  pickup_date?: string; // optional: YYYY-MM-DD
  reference_id?: string; // optional: your internal ID
}
export interface ShipmentResponse {
  shipment_id: string;
  tracking_number: string;
  courier: string;
  status: string;
  estimated_delivery?: string;
  created_at: string;
  label_url?: string; // URL to download shipping label
}
