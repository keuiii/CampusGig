import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeliveryOption, RushTier } from "@prisma/client";

export const MARKETPLACE_PRICING_POLICY_VERSION = 1;

const deliveryMinutes: Record<DeliveryOption, number | null> = {
  NORMAL: null,
  RUSH_24_HOURS: 24 * 60,
  RUSH_12_HOURS: 12 * 60,
  RUSH_6_HOURS: 6 * 60,
  RUSH_3_HOURS: 3 * 60,
};

const fastestMinutes: Record<RushTier, number> = {
  HOURS_24: 24 * 60,
  HOURS_12: 12 * 60,
  HOURS_6: 6 * 60,
  HOURS_3: 3 * 60,
};

export function validateProviderRushSettings(input: {
  normalDeliveryMinutes: number;
  acceptsRushOrders: boolean;
  fastestRushTier: RushTier | null;
}) {
  if (!input.acceptsRushOrders && input.fastestRushTier !== null)
    throw new BadRequestException(
      "A fastest rush turnaround is only valid when rush orders are enabled",
    );
  if (input.acceptsRushOrders && input.fastestRushTier === null)
    throw new BadRequestException(
      "Choose the fastest rush turnaround you can support",
    );
  if (
    input.acceptsRushOrders &&
    input.fastestRushTier &&
    fastestMinutes[input.fastestRushTier] >= input.normalDeliveryMinutes
  )
    throw new BadRequestException(
      "Normal delivery must be slower than the fastest supported rush tier",
    );
}

const rushConfiguration: Record<
  Exclude<DeliveryOption, "NORMAL">,
  { key: string; fallback: number }
> = {
  RUSH_24_HOURS: { key: "RUSH_24_HOURS_BASIS_POINTS", fallback: 2_000 },
  RUSH_12_HOURS: { key: "RUSH_12_HOURS_BASIS_POINTS", fallback: 3_000 },
  RUSH_6_HOURS: { key: "RUSH_6_HOURS_BASIS_POINTS", fallback: 4_000 },
  RUSH_3_HOURS: { key: "RUSH_3_HOURS_BASIS_POINTS", fallback: 5_000 },
};

export type V2PricingTerms = {
  basePriceCentavos: number;
  normalDeliveryMinutes: number;
  includedRevisionLimit: number;
  acceptsRushOrders: boolean;
  fastestRushTier: RushTier | null;
};

export type MarketplaceQuote = {
  pricingModel: "SINGLE_PRICE_V2";
  currency: "PHP";
  basePriceCentavos: number;
  deliveryOption: DeliveryOption;
  deliveryDurationMinutes: number;
  rushSurchargeCentavos: number;
  providerServiceSubtotalCentavos: number;
  platformFeeCentavos: number;
  clientTotalCentavos: number;
  platformFeeBasisPoints: number;
  rushBasisPoints: number;
  pricingPolicyVersion: number;
};

@Injectable()
export class MarketplacePricingPolicy {
  constructor(private readonly config: ConfigService) {}

  eligibleDeliveryOptions(terms: V2PricingTerms): DeliveryOption[] {
    this.validateTerms(terms);
    const options: DeliveryOption[] = [DeliveryOption.NORMAL];
    if (!terms.acceptsRushOrders || !terms.fastestRushTier) return options;
    const minimumMinutes = fastestMinutes[terms.fastestRushTier];
    for (const option of [
      DeliveryOption.RUSH_24_HOURS,
      DeliveryOption.RUSH_12_HOURS,
      DeliveryOption.RUSH_6_HOURS,
      DeliveryOption.RUSH_3_HOURS,
    ]) {
      const minutes = deliveryMinutes[option]!;
      if (minutes < terms.normalDeliveryMinutes && minutes >= minimumMinutes)
        options.push(option);
    }
    return options;
  }

  quote(terms: V2PricingTerms, option: DeliveryOption): MarketplaceQuote {
    if (!Object.values(DeliveryOption).includes(option))
      throw new BadRequestException("Select a valid delivery option");
    if (!this.eligibleDeliveryOptions(terms).includes(option))
      throw new BadRequestException(
        "The selected delivery option is not available for this service",
      );
    const platformFeeBasisPoints = this.configuredInteger(
      "PLATFORM_FEE_BASIS_POINTS",
      500,
      0,
      10_000,
    );
    const platformFeeMinimum = this.configuredInteger(
      "PLATFORM_FEE_MIN_CENTAVOS",
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const rushBasisPoints =
      option === DeliveryOption.NORMAL
        ? 0
        : this.rushBasisPoints(option as Exclude<DeliveryOption, "NORMAL">);
    const rushSurchargeCentavos = this.ceilBasisPoints(
      terms.basePriceCentavos,
      rushBasisPoints,
    );
    const providerServiceSubtotalCentavos =
      terms.basePriceCentavos + rushSurchargeCentavos;
    const calculatedFee = this.ceilBasisPoints(
      providerServiceSubtotalCentavos,
      platformFeeBasisPoints,
    );
    const platformFeeCentavos =
      platformFeeBasisPoints === 0
        ? 0
        : Math.max(platformFeeMinimum, calculatedFee);
    return {
      pricingModel: "SINGLE_PRICE_V2",
      currency: "PHP",
      basePriceCentavos: terms.basePriceCentavos,
      deliveryOption: option,
      deliveryDurationMinutes:
        option === DeliveryOption.NORMAL
          ? terms.normalDeliveryMinutes
          : deliveryMinutes[option]!,
      rushSurchargeCentavos,
      providerServiceSubtotalCentavos,
      platformFeeCentavos,
      clientTotalCentavos:
        providerServiceSubtotalCentavos + platformFeeCentavos,
      platformFeeBasisPoints,
      rushBasisPoints,
      pricingPolicyVersion: MARKETPLACE_PRICING_POLICY_VERSION,
    };
  }

  validateProviderRushSettings(input: {
    normalDeliveryMinutes: number;
    acceptsRushOrders: boolean;
    fastestRushTier: RushTier | null;
  }) {
    validateProviderRushSettings(input);
  }

  private validateTerms(terms: V2PricingTerms) {
    if (
      !Number.isSafeInteger(terms.basePriceCentavos) ||
      terms.basePriceCentavos <= 0 ||
      !Number.isSafeInteger(terms.normalDeliveryMinutes) ||
      terms.normalDeliveryMinutes <= 0 ||
      !Number.isSafeInteger(terms.includedRevisionLimit) ||
      terms.includedRevisionLimit < 0
    )
      throw new BadRequestException("This service has invalid pricing terms");
    if (terms.acceptsRushOrders !== Boolean(terms.fastestRushTier))
      throw new BadRequestException("This service has invalid rush settings");
  }

  private rushBasisPoints(option: Exclude<DeliveryOption, "NORMAL">) {
    const setting = rushConfiguration[option];
    return this.configuredInteger(setting.key, setting.fallback, 0, 10_000);
  }

  private ceilBasisPoints(amountCentavos: number, basisPoints: number) {
    return Math.ceil((amountCentavos * basisPoints) / 10_000);
  }

  private configuredInteger(
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const raw = this.config.get<string>(key)?.trim();
    const parsed = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
      throw new ServiceUnavailableException(
        "Marketplace pricing configuration is invalid",
      );
    return parsed;
  }
}
