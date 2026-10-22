import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

type CheckoutData = {
  id: string;
  attributes: { checkout_url: string };
};

type CheckoutPayment = {
  id: string;
  attributes: {
    amount: number;
    currency: string;
    status: string;
    paid_at?: number;
  };
};

export type PaymongoRefund = {
  id: string;
  amountCentavos: number;
  currency: string;
  paymentId: string;
  reason: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  createdAt: Date | null;
  updatedAt: Date | null;
};

export class PaymongoCheckoutError extends BadGatewayException {
  constructor(
    message: string,
    public readonly outcome: "REJECTED" | "UNKNOWN",
  ) {
    super(message);
  }
}

export class PaymongoRefundError extends BadGatewayException {
  constructor(
    message: string,
    public readonly outcome: "REJECTED" | "UNKNOWN",
    public readonly code?: string,
  ) {
    super(message);
  }
}

@Injectable()
export class PaymongoClient {
  constructor(private readonly config: ConfigService) {}

  async createCheckout(input: {
    amountCentavos: number;
    orderId: string;
    orderNumber: string;
    title: string;
    customerName: string;
    customerEmail: string;
    currency?: string;
    returnTarget?: "WEB" | "MOBILE";
    requestOrigin?: string;
    revisionPurchaseId?: string;
  }) {
    const secretKey = this.secretKey();
    const webOrigin =
      this.config.get<string>("WEB_ORIGIN")?.split(",")[0]?.trim() ||
      "http://localhost:3000";
    const returnTarget = input.returnTarget ?? "WEB";
    const returnOrigin =
      returnTarget === "MOBILE"
        ? this.mobileReturnOrigin(input.requestOrigin)
        : webOrigin;
    const methods = (
      this.config.get<string>("PAYMONGO_PAYMENT_METHODS") ||
      "card,gcash,paymaya"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const response = await fetch(
      "https://api.paymongo.com/v1/checkout_sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          data: {
            attributes: {
              billing: { name: input.customerName, email: input.customerEmail },
              cancel_url: this.returnUrl(
                returnTarget === "MOBILE"
                  ? "PAYMONGO_MOBILE_CANCEL_URL"
                  : "PAYMONGO_CANCEL_URL",
                returnOrigin,
                "cancelled",
                input.orderId,
                returnTarget,
                input.revisionPurchaseId,
              ),
              success_url: this.returnUrl(
                returnTarget === "MOBILE"
                  ? "PAYMONGO_MOBILE_SUCCESS_URL"
                  : "PAYMONGO_SUCCESS_URL",
                returnOrigin,
                "success",
                input.orderId,
                returnTarget,
                input.revisionPurchaseId,
              ),
              description: `CampusGig order ${input.orderNumber}`,
              reference_number: input.orderNumber,
              send_email_receipt: true,
              show_description: true,
              show_line_items: true,
              payment_method_types: methods,
              line_items: [
                {
                  amount: input.amountCentavos,
                  currency: (input.currency ?? "PHP").toUpperCase(),
                  description: `Student service for ${input.orderNumber}`,
                  name: input.title,
                  quantity: 1,
                },
              ],
            },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(() => {
      throw new PaymongoCheckoutError(
        "PayMongo is temporarily unavailable. CampusGig will verify whether the checkout was created before allowing another attempt.",
        "UNKNOWN",
      );
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: CheckoutData;
      errors?: { detail?: string }[];
    } | null;
    if (!response.ok) {
      const definitiveRejection = [400, 401, 403, 404, 422].includes(
        response.status,
      );
      throw new PaymongoCheckoutError(
        payload?.errors?.[0]?.detail ||
          "PayMongo could not create the checkout",
        definitiveRejection ? "REJECTED" : "UNKNOWN",
      );
    }
    if (!payload?.data?.id || !payload.data.attributes.checkout_url)
      throw new PaymongoCheckoutError(
        "PayMongo returned an incomplete checkout response. CampusGig will verify the payment before allowing another attempt.",
        "UNKNOWN",
      );
    return payload.data;
  }

  async paidCheckout(checkoutId: string) {
    const secretKey = this.secretKey();
    const response = await fetch(
      `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(checkoutId)}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new BadGatewayException(
        "PayMongo payment verification is temporarily unavailable",
      );
    const payload = (await response.json()) as {
      data?: { id?: string; attributes?: { payments?: CheckoutPayment[] } };
    };
    if (payload.data?.id !== checkoutId)
      throw new BadGatewayException("PayMongo returned the wrong checkout");
    const paid = payload.data.attributes?.payments?.find(
      (payment) => payment.attributes.status === "paid",
    );
    if (!paid) return null;
    return {
      id: paid.id,
      amountCentavos: paid.attributes.amount,
      currency: paid.attributes.currency,
      paidAt: paymongoTimestamp(paid.attributes.paid_at),
    };
  }

  async createRefund(input: {
    amountCentavos: number;
    paymentId: string;
    idempotencyKey: string;
    notes: string;
  }): Promise<PaymongoRefund> {
    return this.refundRequest("https://api.paymongo.com/v1/refunds", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        data: {
          attributes: {
            amount: input.amountCentavos,
            payment_id: input.paymentId,
            reason: "others",
            notes: input.notes,
          },
        },
      },
    });
  }

  async retrieveRefund(refundId: string): Promise<PaymongoRefund> {
    return this.refundRequest(
      `https://api.paymongo.com/v1/refunds/${encodeURIComponent(refundId)}`,
      { method: "GET" },
    );
  }

  private async refundRequest(
    url: string,
    input: {
      method: "GET" | "POST";
      idempotencyKey?: string;
      body?: unknown;
    },
  ): Promise<PaymongoRefund> {
    const secretKey = this.secretKey();
    const response = await fetch(url, {
      method: input.method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(input.idempotencyKey
          ? { "Idempotency-Key": input.idempotencyKey }
          : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new PaymongoRefundError(
        "PayMongo did not confirm the refund outcome. Reconciliation is required before any retry.",
        "UNKNOWN",
      );
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: {
        id?: string;
        attributes?: {
          amount?: number;
          currency?: string;
          payment_id?: string;
          reason?: string;
          status?: string;
          created_at?: number;
          updated_at?: number;
        };
      };
      errors?: { code?: string; detail?: string }[];
    } | null;
    if (!response.ok) {
      const definitiveRejection = [400, 401, 403, 404, 422].includes(
        response.status,
      );
      throw new PaymongoRefundError(
        payload?.errors?.[0]?.detail || "PayMongo could not process the refund",
        definitiveRejection ? "REJECTED" : "UNKNOWN",
        payload?.errors?.[0]?.code,
      );
    }
    const resource = payload?.data;
    const attributes = resource?.attributes;
    const status = attributes?.status;
    if (
      !resource?.id ||
      !Number.isSafeInteger(attributes?.amount) ||
      attributes!.amount! <= 0 ||
      !attributes?.payment_id ||
      !attributes.currency ||
      !status ||
      !["pending", "processing", "succeeded", "failed"].includes(status)
    )
      throw new PaymongoRefundError(
        "PayMongo returned an incomplete refund response. Reconciliation is required.",
        "UNKNOWN",
      );
    return {
      id: resource.id,
      amountCentavos: attributes.amount!,
      currency: attributes.currency.toUpperCase(),
      paymentId: attributes.payment_id,
      reason: attributes.reason ?? "others",
      status: status as PaymongoRefund["status"],
      createdAt: paymongoTimestamp(attributes.created_at),
      updatedAt: paymongoTimestamp(attributes.updated_at),
    };
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    const secret = this.required("PAYMONGO_WEBHOOK_SECRET");
    if (!signatureHeader)
      throw new UnauthorizedException("Missing PayMongo signature");
    const fields = Object.fromEntries(
      signatureHeader.split(",").map((part) => part.trim().split("=", 2)),
    );
    const timestamp = fields.t;
    const provided = fields[this.mode() === "live" ? "li" : "te"];
    if (!timestamp || !provided || !/^\d+$/.test(timestamp))
      throw new UnauthorizedException("Invalid PayMongo signature");
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (ageSeconds > 300)
      throw new UnauthorizedException("Expired PayMongo signature");
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody.toString("utf8")}`)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(provided, "utf8");
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    )
      throw new UnauthorizedException("Invalid PayMongo signature");
  }

  private required(key: string) {
    const value = this.config.get<string>(key)?.trim();
    if (!value)
      throw new ServiceUnavailableException(`${key} is not configured`);
    return value;
  }

  private secretKey() {
    const mode = this.mode();
    if (
      mode === "live" &&
      this.config.get<string>("NODE_ENV")?.trim() !== "production"
    )
      throw new ServiceUnavailableException(
        "PayMongo live mode requires the production environment",
      );
    const secretKey = this.required("PAYMONGO_SECRET_KEY");
    const expectedPrefix = mode === "live" ? "sk_live_" : "sk_test_";
    if (!secretKey.startsWith(expectedPrefix))
      throw new ServiceUnavailableException(
        `PAYMONGO_SECRET_KEY does not match PayMongo ${mode} mode`,
      );
    return secretKey;
  }

  private mode(): "test" | "live" {
    const mode =
      this.config.get<string>("PAYMONGO_MODE")?.trim().toLowerCase() || "test";
    if (mode !== "test" && mode !== "live")
      throw new ServiceUnavailableException(
        "PAYMONGO_MODE must be test or live",
      );
    return mode;
  }

  private returnUrl(
    key: string,
    origin: string,
    status: string,
    orderId: string,
    returnTarget: "WEB" | "MOBILE",
    revisionPurchaseId?: string,
  ) {
    const configured = this.config.get<string>(key)?.trim();
    let url = new URL(
      configured
        ? configured.replaceAll("{orderId}", encodeURIComponent(orderId))
        : origin,
    );
    if (returnTarget === "MOBILE" && isLoopbackHostname(url.hostname)) {
      const mobileOrigin = new URL(origin);
      if (mobileOrigin.pathname.endsWith("/payments/mobile-return")) {
        url = mobileOrigin;
      } else if (!isLoopbackHostname(mobileOrigin.hostname)) {
        url.protocol = mobileOrigin.protocol;
        url.hostname = mobileOrigin.hostname;
        url.port = mobileOrigin.port;
      }
    }
    url.searchParams.set("payment", status);
    url.searchParams.set("orderId", orderId);
    if (revisionPurchaseId)
      url.searchParams.set("revisionPurchaseId", revisionPurchaseId);
    if (returnTarget === "MOBILE")
      url.searchParams.set("paymentTarget", "mobile");
    return url.toString();
  }

  private mobileReturnOrigin(requestOrigin?: string) {
    const configured = this.config
      .get<string>("PAYMONGO_MOBILE_RETURN_ORIGIN")
      ?.trim();
    const localApiBridge =
      this.config.get<string>("NODE_ENV") !== "production"
        ? localMobileReturnOrigin(requestOrigin)
        : null;
    if (localApiBridge) return localApiBridge;

    const origin = configured || "http://10.0.2.2:3000";
    const url = new URL(origin);
    if (
      this.config.get<string>("NODE_ENV") === "production" &&
      url.protocol !== "https:"
    )
      throw new ServiceUnavailableException(
        "PAYMONGO_MOBILE_RETURN_ORIGIN must use HTTPS in production",
      );
    return url.toString();
  }
}

function localMobileReturnOrigin(requestOrigin?: string) {
  if (!requestOrigin) return null;
  try {
    const url = new URL(requestOrigin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (!isLoopbackHostname(url.hostname) && !isPrivateLanAddress(url.hostname))
    )
      return null;
    url.pathname = "/api/v1/payments/mobile-return";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export function isPrivateLanAddress(hostname: string) {
  if (isIP(hostname) !== 4) return false;
  const [first, second] = hostname.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function paymongoTimestamp(value: unknown): Date | null {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) return null;
  const timestamp = new Date((value as number) * 1_000);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}
