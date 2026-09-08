import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";

type CheckoutData = {
  id: string;
  attributes: { checkout_url: string };
};

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
  }) {
    const secretKey = this.required("PAYMONGO_SECRET_KEY");
    if (!secretKey.startsWith("sk_test_"))
      throw new ServiceUnavailableException(
        "CampusGig payments are restricted to PayMongo test mode",
      );
    const webOrigin = this.config.get<string>("WEB_ORIGIN")?.split(",")[0]?.trim() || "http://localhost:3000";
    const methods = (this.config.get<string>("PAYMONGO_PAYMENT_METHODS") || "card,gcash,paymaya")
      .split(",").map((value) => value.trim()).filter(Boolean);
    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        data: { attributes: {
          billing: { name: input.customerName, email: input.customerEmail },
          cancel_url: this.returnUrl("PAYMONGO_CANCEL_URL", webOrigin, "cancelled", input.orderId),
          success_url: this.returnUrl("PAYMONGO_SUCCESS_URL", webOrigin, "success", input.orderId),
          description: `CampusGig order ${input.orderNumber}`,
          reference_number: input.orderNumber,
          send_email_receipt: true,
          show_description: true,
          show_line_items: true,
          payment_method_types: methods,
          line_items: [{
            amount: input.amountCentavos,
            currency: "PHP",
            description: `Student service for ${input.orderNumber}`,
            name: input.title,
            quantity: 1,
          }],
        } },
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new BadGatewayException("PayMongo is temporarily unavailable");
    });
    const payload = (await response.json().catch(() => null)) as
      | { data?: CheckoutData; errors?: { detail?: string }[] }
      | null;
    if (!response.ok || !payload?.data?.attributes.checkout_url)
      throw new BadGatewayException(
        payload?.errors?.[0]?.detail || "PayMongo could not create the checkout",
      );
    return payload.data;
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    const secret = this.required("PAYMONGO_WEBHOOK_SECRET");
    if (!signatureHeader) throw new UnauthorizedException("Missing PayMongo signature");
    const fields = Object.fromEntries(
      signatureHeader.split(",").map((part) => part.trim().split("=", 2)),
    );
    const timestamp = fields.t;
    const provided = fields.te;
    if (!timestamp || !provided || !/^\d+$/.test(timestamp))
      throw new UnauthorizedException("Invalid PayMongo signature");
    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (ageSeconds > 300) throw new UnauthorizedException("Expired PayMongo signature");
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody.toString("utf8")}`)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(provided, "utf8");
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) throw new UnauthorizedException("Invalid PayMongo signature");
  }

  private required(key: string) {
    const value = this.config.get<string>(key)?.trim();
    if (!value) throw new ServiceUnavailableException(`${key} is not configured`);
    return value;
  }

  private returnUrl(key: string, origin: string, status: string, orderId: string) {
    const configured = this.config.get<string>(key)?.trim();
    if (configured)
      return configured.replaceAll("{orderId}", encodeURIComponent(orderId));
    const url = new URL(origin);
    url.searchParams.set("payment", status);
    url.searchParams.set("orderId", orderId);
    return url.toString();
  }
}
