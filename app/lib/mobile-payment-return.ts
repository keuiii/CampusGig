export type MobilePaymentReturn = {
  status: "success" | "cancelled";
  orderId: string;
  revisionPurchaseId?: string;
  deepLink: string;
  androidIntent: string;
};

export function readMobilePaymentReturn(
  search: string,
): MobilePaymentReturn | null {
  const params = new URLSearchParams(search);
  if (params.get("paymentTarget") !== "mobile") return null;

  const status = params.get("payment");
  const orderId = params.get("orderId")?.trim();
  const revisionPurchaseId = params.get("revisionPurchaseId")?.trim();
  if (!orderId || (status !== "success" && status !== "cancelled")) {
    return null;
  }

  const appParams = new URLSearchParams({ payment: status, orderId });
  if (revisionPurchaseId)
    appParams.set("revisionPurchaseId", revisionPurchaseId);
  const query = appParams.toString();
  return {
    status,
    orderId,
    revisionPurchaseId: revisionPurchaseId || undefined,
    deepLink: `campusgig://payment-return?${query}`,
    androidIntent:
      `intent://payment-return?${query}` +
      "#Intent;scheme=campusgig;package=com.campusgig.app;end",
  };
}

export function preferredMobileReturnUrl(
  paymentReturn: MobilePaymentReturn,
  userAgent: string,
) {
  return /Android/i.test(userAgent)
    ? paymentReturn.androidIntent
    : paymentReturn.deepLink;
}
