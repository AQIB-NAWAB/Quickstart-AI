import type { AvailablePhoneNumber, PhoneNumberType } from "@quickstart/contracts";

export type TelnyxSearchNumbersInput = {
  countryCode?: string;
  areaCode?: string;
  locality?: string;
  state?: string;
  numberType?: PhoneNumberType;
  limit?: number;
};

export type TelnyxOwnedNumber = {
  id: string;
  phoneNumber: string;
  connectionId: string | null;
  status: string;
  countryCode: string | null;
  numberType: PhoneNumberType | null;
  region: string | null;
  locality: string | null;
  monthlyCost: number | null;
  currency: string | null;
  features: string[];
};

export type TelnyxOrderStatus =
  | "pending"
  | "success"
  | "failure"
  | "cancelled"
  | "deleted";

export type TelnyxNumberOrder = {
  id: string;
  status: TelnyxOrderStatus;
  phoneNumberIds: string[];
  error?: string;
};

export type TelnyxFqdnConnection = {
  id: string;
  connectionName: string;
};

export type TelnyxFqdn = {
  id: string;
  fqdn: string;
  connectionId: string;
};

export interface TelnyxNumbersClient {
  readonly kind: "telnyx" | "fake" | "disabled";
  searchAvailableNumbers(input: TelnyxSearchNumbersInput): Promise<AvailablePhoneNumber[]>;
  listOwnedNumbers(): Promise<TelnyxOwnedNumber[]>;
  createNumberOrder(
    e164s: string[],
    connectionId?: string,
    customerReference?: string,
  ): Promise<TelnyxNumberOrder>;
  getNumberOrder(orderId: string): Promise<TelnyxNumberOrder>;
  createFqdnConnection(name: string): Promise<TelnyxFqdnConnection>;
  createFqdn(connectionId: string, fqdn: string): Promise<TelnyxFqdn>;
  assignNumberToConnection(numberId: string, connectionId: string): Promise<TelnyxOwnedNumber>;
  releaseNumber(numberId: string): Promise<void>;
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): boolean;
}
