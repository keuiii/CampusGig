# CampusGig monetization architecture

Status: design checkpoint for Phase 2. No production fee should be enabled until the staging transaction journey, refund reconciliation, provider payout process, tax treatment, and user-facing disclosures are approved.

## Recommended rollout

1. Transaction fees on completed fixed-price orders.
2. Time-bounded featured listings with an explicit Sponsored label.
3. Optional priority verification review, sold only as a faster review SLA and never as guaranteed approval.

This order builds on the existing order ledger first, keeps marketplace ranking understandable, and leaves the most policy-sensitive option until operating data exists.

## Shared financial rules

- Store all money as integer centavos and an ISO currency code. Never use floating-point money.
- Calculate prices and fees only in the API. Web and mobile display the server quote but cannot submit an authoritative fee.
- Snapshot the fee policy, basis points, minimum fee, subtotal, fee, total, and provider net on the order before checkout is created.
- Treat a signed PayMongo webhook as payment evidence. A return URL is navigation only and must never mark a purchase paid.
- Use a unique idempotency key for every checkout, webhook event, refund, promotion purchase, and verification purchase.
- Keep an append-only double-entry journal. Corrections use compensating entries; financial rows are never edited or deleted.
- Recognize platform revenue only when the configured earning event occurs, recommended at order completion after any dispute hold. A successful collection is initially a liability.
- Reconcile PayMongo transactions, refunds, fees, and internal journal totals daily. Alert on any mismatch rather than silently correcting it.
- Put all monetization modes and rates behind server-side feature flags with effective dates. Existing orders retain their original fee snapshot.

Suggested accounting records:

```text
FeePolicy(id, version, basisPoints, minimumCentavos, effectiveFrom, effectiveTo)
JournalEntry(id, eventType, sourceId, idempotencyKey, occurredAt)
JournalLine(id, journalEntryId, account, direction, amountCentavos, currency)
Payout(id, providerId, periodStart, periodEnd, grossCentavos, feeCentavos,
       refundCentavos, netCentavos, providerReference, status)
```

The existing `Order.platformFeeCentavos`, `Payment.platformFeeCentavos`, `Payment.providerNetCentavos`, refund records, and webhook-event table are the correct starting point. The journal and payout records add auditable accounting rather than replacing those operational records.

## Option 1: service transaction fee

Recommended MVP policy: add a clearly disclosed client service fee while preserving the provider's listed package price. CampusGig already supports this shape through `PLATFORM_FEE_BASIS_POINTS` and `PLATFORM_FEE_MIN_CENTAVOS`; keep both at zero until policy approval.

Implementation sequence:

1. Add versioned `FeePolicy` data and an API quote response containing subtotal, fee, total, currency, policy version, and plain-language disclosure.
2. Persist the quote snapshot atomically when the order is requested. Recalculate only if the package or quote is explicitly replaced before acceptance.
3. Create one active checkout per order and reuse it while valid. Concurrent checkout requests must return the same pending payment or conflict cleanly.
4. On a signed paid webhook, record collection and liability journal entries in the same database transaction as the payment status transition.
5. At order completion, move the fee portion to earned platform revenue and the provider portion to payable. Disputes place the relevant payable amount on hold.
6. Refunds create compensating journal entries. Partial refunds allocate fee reversal according to the published policy, not ad hoc administrator input.
7. Generate a provider earnings statement and an administrator reconciliation export before enabling production payouts.

Required UI:

- Show package price, CampusGig fee, and total before the client confirms the request and again before checkout.
- Show the provider's gross price, deductions, refunds, and net earnings separately.
- Never hide the fee inside the package price or introduce it only on the PayMongo page.

Acceptance criteria:

- Repeated checkout calls and duplicate webhooks cannot charge or credit twice.
- The order, payment, journal, refund, and payout totals balance to zero for every currency.
- A changed global fee does not alter an existing order.
- Full and partial refund tests cover paid, completed, disputed, and already-partially-refunded orders.

## Option 2: featured listing promotions

Sell a fixed-duration visibility product rather than a promise of sales or a permanent ranking advantage.

Suggested records:

```text
PromotionProduct(id, name, durationHours, priceCentavos, currency, active)
ListingPromotion(id, serviceId, providerId, productId, startsAt, endsAt,
                 status, paymentReference, createdAt)
PromotionImpression(id, promotionId, viewerHash, occurredAt)
PromotionClick(id, promotionId, viewerHash, occurredAt)
```

Implementation rules:

- Give promotion checkout its own payment purpose and persistence model. Do not attach a fake order to the existing order-only `Payment` relation.
- Activate a promotion only from a signed paid webhook and make activation idempotent.
- Promote only approved, published, available listings that still pass normal school/category filters.
- Blend sponsored results after relevance filtering, cap their frequency, and label every placement `Sponsored` on web and mobile.
- Pause the clock or issue a defined credit when CampusGig suspends a listing for a platform fault. Policy violations do not earn a credit.
- Record impressions and clicks without storing raw IP addresses; use short-lived pseudonymous viewer hashes.

Acceptance criteria:

- Expired, paused, rejected, or unavailable services cannot appear as sponsored.
- Organic ranking remains deterministic when no eligible promotion exists.
- Promotion payment, start/end time, impressions, clicks, and credits are auditable.
- Clients can distinguish sponsored and organic results without opening a listing.

## Option 3: priority verification review

This may sell a response-time target, not verified status. The same evidence checks, rejection rules, and reviewer audit trail apply to paid and free requests.

Suggested record:

```text
VerificationExpedite(id, verificationRequestId, purchaserId, priceCentavos,
                     promisedBy, reviewedAt, status, paymentReference,
                     refundStatus, createdAt)
```

Implementation rules:

- Offer priority review only when staff capacity can meet the displayed SLA.
- Calculate `promisedBy` using business hours and persist it at purchase time.
- Place paid requests in a priority queue but never alter the approval decision or bypass school authorization.
- Automatically refund or credit missed SLAs according to a published policy.
- Keep a free standard-review path visible and usable.
- Audit reviewer identity, evidence access, decision, reason, and timing.

Because this feature touches identity verification and student trust, launch it only after legal, fairness, and school-partner review. If it creates unequal access or operational pressure to approve, do not ship it.

## Controls and observability

- Administrator roles for fee-policy changes, refunds, promotion credits, and payout approval must be separate where staffing allows.
- Require 2FA re-authentication for rate changes, manual refunds, payout changes, and promotion credits.
- Audit every configuration change with actor, old value, new value, reason, and timestamp.
- Alert on webhook signature failures, duplicate-event spikes, negative provider balances, reconciliation mismatches, overdue payouts, and priority-review SLA breaches.
- Track checkout conversion, refund/dispute rate, provider net earnings, sponsored click-through and conversion, and support volume after each pricing change.

## Decision gates

Transaction fees can enter staging after the current full order journey is certified. Featured listings require stable discovery ranking and analytics. Priority verification requires an operating SLA and policy approval. Production activation for any option also requires PayMongo product confirmation, provider payout onboarding, tax/accounting review, terms updates, privacy review, and support procedures.
