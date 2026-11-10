import { AppError, ErrorCode } from "@quickstart/errors";
import type { AvailablePhoneNumber } from "@quickstart/contracts";
import type {
  TelnyxFqdn,
  TelnyxFqdnConnection,
  TelnyxNumberOrder,
  TelnyxNumbersClient,
  TelnyxOwnedNumber,
} from "./types.js";

const MESSAGE =
  "Buying numbers is not enabled on this deployment. Register your own SIP trunk instead.";

/**
 * Stand-in for deployments that deliberately run without a platform carrier account
 * (`TELEPHONY_PROFILE=sip`). Inventory is empty and every mutation fails with a clear
 * message, so the number-purchase UI cannot offer fake demo numbers.
 */
export class DisabledTelnyxClient implements TelnyxNumbersClient {
  readonly kind = "disabled" as const;

  async searchAvailableNumbers(): Promise<AvailablePhoneNumber[]> {
    return [];
  }

  async listOwnedNumbers(): Promise<TelnyxOwnedNumber[]> {
    return [];
  }

  async createNumberOrder(): Promise<TelnyxNumberOrder> {
    throw this.unavailable();
  }

  async getNumberOrder(): Promise<TelnyxNumberOrder> {
    throw this.unavailable();
  }

  async createFqdnConnection(): Promise<TelnyxFqdnConnection> {
    throw this.unavailable();
  }

  async createFqdn(): Promise<TelnyxFqdn> {
    throw this.unavailable();
  }

  async assignNumberToConnection(): Promise<TelnyxOwnedNumber> {
    throw this.unavailable();
  }

  async releaseNumber(): Promise<void> {
    throw this.unavailable();
  }

  verifyWebhook(): boolean {
    return false;
  }

  private unavailable(): AppError {
    return new AppError({ code: ErrorCode.VALIDATION_FAILED, message: MESSAGE });
  }
}
