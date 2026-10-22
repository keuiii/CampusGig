import { createHash } from "node:crypto";
import type { CreateOrderDto } from "./dto/create-order.dto";

export function orderRequestFingerprint(input: CreateOrderDto) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        serviceId: input.serviceId,
        servicePackageId: input.servicePackageId,
        deliveryOption: input.deliveryOption ?? null,
        requirements: input.requirements.trim(),
        requestedDeliveryDate: input.requestedDeliveryDate ?? null,
      }),
    )
    .digest("hex");
}
