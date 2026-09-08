CREATE UNIQUE INDEX "Payment_one_active_checkout_per_order"
ON "Payment" ("orderId")
WHERE "status" IN ('PENDING', 'REQUIRES_ACTION', 'PAID');
