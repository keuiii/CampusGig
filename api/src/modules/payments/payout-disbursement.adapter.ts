import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type DisbursementResult = {
  externalPayoutId: string;
  status: "processing" | "paid" | "failed" | "unknown";
};

export interface PayoutDisbursementAdapter {
  createDisbursement(input: {
    payoutId: string;
    amountCentavos: number;
    currency: string;
    destinationToken: string;
    idempotencyKey: string;
  }): Promise<DisbursementResult>;
  getDisbursement(externalPayoutId: string): Promise<DisbursementResult>;
  reconcileDisbursement(externalPayoutId: string): Promise<DisbursementResult>;
}

@Injectable()
export class DisabledPayoutDisbursementAdapter
  implements PayoutDisbursementAdapter
{
  constructor(private readonly config: ConfigService) {}

  private unavailable(): never {
    const provider = (
      this.config.get<string>("PAYOUT_PROVIDER") ?? "disabled"
    ).toLowerCase();
    throw new ServiceUnavailableException(
      `Automated payout is disabled (${provider}). Use the evidence-backed manual settlement workflow.`,
    );
  }

  async createDisbursement(): Promise<DisbursementResult> {
    return this.unavailable();
  }

  async getDisbursement(): Promise<DisbursementResult> {
    return this.unavailable();
  }

  async reconcileDisbursement(): Promise<DisbursementResult> {
    return this.unavailable();
  }
}
