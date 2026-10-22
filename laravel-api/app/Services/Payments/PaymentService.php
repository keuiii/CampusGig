<?php

namespace App\Services\Payments;

use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PaymentService
{
    public function __construct(
        private readonly PaymongoClient $paymongo,
        private readonly RefundService $refunds,
    ) {}

    public function forOrder(string $userId, string $orderId): array
    {
        $this->participantOrder($userId, $orderId);
        $this->reconcilePendingPayment($orderId);
        $this->reconcilePendingRevisionPurchases($orderId);
        $payments = DB::table('Payment')->where('orderId', $orderId)->orderByDesc('createdAt')->get();
        $refunds = DB::table('PaymentRefund')->whereIn('paymentId', $payments->pluck('id'))
            ->orderByDesc('createdAt')->get()->groupBy('paymentId');

        return ['data' => $payments
            ->map(fn (object $payment): array => $this->publicPayment(
                $payment,
                ($refunds->get($payment->id) ?? collect())->map(fn (object $refund): array => RefundService::publicRefund($refund))->all(),
            ))->all()];
    }

    public function createCheckout(string $userId, string $orderId, string $returnTarget): array
    {
        $order = DB::table('Order as orders')->join('User as client', 'client.id', '=', 'orders.clientId')
            ->where('orders.id', $orderId)->select('orders.*', 'client.displayName as clientName', 'client.email as clientEmail')->first();
        if (! $order) {
            throw $this->notFound('Order not found');
        }
        if ($order->clientId !== $userId) {
            throw $this->forbidden('Only the client can pay for this order');
        }
        if (! in_array($order->status, ['ACCEPTED', 'IN_PROGRESS', 'REVISION_REQUESTED', 'SUBMITTED', 'COMPLETED'], true)) {
            throw $this->conflict('Payment is available after the provider accepts the request');
        }
        $settled = DB::table('Payment')->where('orderId', $orderId)
            ->whereIn('status', ['PAID', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'])->orderByDesc('createdAt')->first();
        if ($settled) {
            throw $this->conflict(match ($settled->status) {
                'PAID' => 'This order has already been paid',
                'REFUND_PENDING' => 'A full refund is already in progress for this payment',
                default => 'This order has already been paid and refunded. A new checkout cannot be created automatically. Contact support if another payment is required.',
            });
        }

        $payment = DB::transaction(function () use ($orderId): object {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $active = DB::table('Payment')->where('orderId', $orderId)
                ->whereIn('status', ['PENDING', 'REQUIRES_ACTION'])->orderByDesc('createdAt')->first();
            if ($active) {
                return $active;
            }
            $financials = DB::table('Order')->where('id', $orderId)->first();
            if (! $financials || (int) $financials->totalCentavos <= 0
                || (int) $financials->totalCentavos !== (int) $financials->subtotalCentavos + (int) $financials->platformFeeCentavos) {
                throw $this->badRequest('Order payment totals are inconsistent');
            }
            $id = (string) Str::uuid();
            $now = now();
            DB::table('Payment')->insert([
                'id' => $id, 'orderId' => $orderId, 'provider' => 'PAYMONGO',
                'idempotencyKey' => "checkout:{$orderId}:".Str::uuid(),
                'amountCentavos' => $financials->totalCentavos,
                'platformFeeCentavos' => $financials->platformFeeCentavos,
                'providerNetCentavos' => $financials->subtotalCentavos,
                'refundedCentavos' => 0, 'currency' => $financials->currency,
                'status' => 'PENDING', 'createdAt' => $now, 'updatedAt' => $now,
            ]);

            return DB::table('Payment')->where('id', $id)->first();
        });
        if ($payment->checkoutUrl) {
            return ['data' => $this->publicPayment($payment), 'checkoutUrl' => $payment->checkoutUrl];
        }
        if ($payment->failureCode === 'checkout_creation_unknown') {
            throw $this->conflict('The previous checkout attempt is still being verified. Do not start another payment. Refresh the order shortly or contact support.');
        }
        $claimed = DB::table('Payment')->where('id', $payment->id)->where('status', 'PENDING')->whereNull('checkoutUrl')
            ->update(['status' => 'REQUIRES_ACTION', 'failureCode' => null, 'updatedAt' => now()]);
        if ($claimed !== 1) {
            throw $this->conflict('Checkout is still being prepared. Please try again shortly');
        }
        try {
            $checkout = $this->paymongo->createCheckout([
                'amountCentavos' => (int) $payment->amountCentavos, 'orderId' => $orderId,
                'orderNumber' => $order->orderNumber, 'title' => $order->titleSnapshot,
                'customerName' => $order->clientName, 'customerEmail' => $order->clientEmail,
                'currency' => $payment->currency, 'returnTarget' => $returnTarget,
            ]);
            DB::table('Payment')->where('id', $payment->id)->where('status', 'REQUIRES_ACTION')->update([
                'providerCheckoutId' => $checkout['id'], 'checkoutUrl' => $checkout['checkoutUrl'], 'updatedAt' => now(),
            ]);
        } catch (PaymongoCheckoutException $error) {
            DB::table('Payment')->where('id', $payment->id)->where('status', 'REQUIRES_ACTION')->whereNull('checkoutUrl')->update(
                $error->outcome === 'REJECTED'
                    ? ['status' => 'FAILED', 'failureCode' => 'checkout_rejected', 'updatedAt' => now()]
                    : ['failureCode' => 'checkout_creation_unknown', 'updatedAt' => now()],
            );
            throw $this->badGateway($error->getMessage());
        }
        $updated = DB::table('Payment')->where('id', $payment->id)->first();

        return ['data' => $this->publicPayment($updated), 'checkoutUrl' => $updated->checkoutUrl];
    }

    public function quoteExtraRevision(string $userId, string $orderId): array
    {
        return DB::transaction(function () use ($userId, $orderId): array {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $context = $this->extraRevisionContext($userId, $orderId);

            return ['data' => [
                ...$context['quote'], 'sourceOrderId' => $orderId,
                'currentDeliverySubmissionId' => $context['order']->reviewDeliverySubmissionId,
            ]];
        });
    }

    public function createExtraRevisionCheckout(string $userId, string $orderId, string $instructions, string $returnTarget): array
    {
        $note = trim($instructions);
        $prepared = DB::transaction(function () use ($userId, $orderId, $note): array {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $context = $this->extraRevisionContext($userId, $orderId);
            $sourceId = $context['order']->reviewDeliverySubmissionId;
            $existing = DB::table('OrderRevisionPurchase')->where('sourceDeliverySubmissionId', $sourceId)
                ->whereNotIn('paymentStatus', ['FAILED', 'CANCELLED'])->orderByDesc('createdAt')->first();
            if ($existing) {
                if ($existing->instructions !== $note) {
                    throw $this->conflict('An extra-revision checkout already exists for this delivery with different instructions');
                }

                return ['purchase' => $existing, 'order' => $context['order'], 'created' => false];
            }
            $id = (string) Str::uuid();
            $now = now();
            $quote = $context['quote'];
            DB::table('OrderRevisionPurchase')->insert([
                'id' => $id, 'orderId' => $orderId, 'sourceDeliverySubmissionId' => $sourceId,
                'clientId' => $userId, 'providerId' => $context['order']->providerId,
                'instructions' => $note, 'providerSubtotalCentavos' => $quote['providerSubtotalCentavos'],
                'platformFeeCentavos' => $quote['platformFeeCentavos'], 'totalCentavos' => $quote['clientTotalCentavos'],
                'currency' => $quote['currency'], 'turnaroundMinutes' => $quote['turnaroundMinutes'],
                'pricingPolicyVersion' => $quote['pricingPolicyVersion'], 'pricingBasisCentavos' => $quote['pricingBasisCentavos'],
                'deliveryDurationBasisMinutes' => $quote['deliveryDurationBasisMinutes'],
                'idempotencyKey' => "revision-checkout:{$orderId}:{$sourceId}:".Str::uuid(),
                'paymentStatus' => 'PENDING', 'activationStatus' => 'PENDING', 'refundedCentavos' => 0,
                'createdAt' => $now, 'updatedAt' => $now,
            ]);

            return ['purchase' => DB::table('OrderRevisionPurchase')->where('id', $id)->first(), 'order' => $context['order'], 'created' => true];
        });
        $purchase = $prepared['purchase'];
        if ($purchase->checkoutUrl) {
            return ['data' => $this->publicRevisionPurchase($purchase), 'checkoutUrl' => $purchase->checkoutUrl];
        }
        if (! $prepared['created'] && $purchase->failureCode === 'checkout_creation_unknown') {
            throw $this->conflict('The previous extra-revision checkout is still being verified. Refresh shortly or contact support.');
        }
        $claimed = DB::table('OrderRevisionPurchase')->where('id', $purchase->id)
            ->where('paymentStatus', 'PENDING')->whereNull('checkoutUrl')
            ->update(['paymentStatus' => 'REQUIRES_ACTION', 'failureCode' => null, 'updatedAt' => now()]);
        if ($claimed !== 1) {
            throw $this->conflict('The extra-revision checkout is still being prepared. Please try again shortly');
        }
        try {
            $checkout = $this->paymongo->createCheckout([
                'amountCentavos' => (int) $purchase->totalCentavos, 'orderId' => $orderId,
                'orderNumber' => $prepared['order']->orderNumber,
                'title' => 'Extra revision for '.$prepared['order']->titleSnapshot,
                'customerName' => $prepared['order']->clientName, 'customerEmail' => $prepared['order']->clientEmail,
                'currency' => $purchase->currency, 'returnTarget' => $returnTarget,
                'revisionPurchaseId' => $purchase->id,
            ]);
            DB::table('OrderRevisionPurchase')->where('id', $purchase->id)->update([
                'providerCheckoutId' => $checkout['id'], 'checkoutUrl' => $checkout['checkoutUrl'], 'updatedAt' => now(),
            ]);
        } catch (PaymongoCheckoutException $error) {
            DB::table('OrderRevisionPurchase')->where('id', $purchase->id)
                ->where('paymentStatus', 'REQUIRES_ACTION')->whereNull('checkoutUrl')->update(
                    $error->outcome === 'REJECTED'
                        ? ['paymentStatus' => 'FAILED', 'failureCode' => 'checkout_rejected', 'updatedAt' => now()]
                        : ['failureCode' => 'checkout_creation_unknown', 'updatedAt' => now()],
                );
            throw $this->badGateway($error->getMessage());
        }
        $updated = DB::table('OrderRevisionPurchase')->where('id', $purchase->id)->first();

        return ['data' => $this->publicRevisionPurchase($updated), 'checkoutUrl' => $updated->checkoutUrl];
    }

    public function processWebhook(array $payload): array
    {
        $eventId = data_get($payload, 'data.id');
        $eventType = data_get($payload, 'data.attributes.type');
        if (! is_string($eventId) || data_get($payload, 'data.type') !== 'event' || ! is_string($eventType)) {
            throw $this->badRequest('Invalid PayMongo webhook payload');
        }
        $live = data_get($payload, 'data.attributes.livemode');
        if (! is_bool($live) || $live !== ($this->paymongo->mode() === 'live')) {
            throw $this->badRequest('PayMongo event does not match the configured payment mode');
        }
        [$event, $duplicate] = $this->recordWebhook($eventId, $eventType, $payload);
        if ($duplicate && $event->processedAt) {
            return ['received' => true, 'duplicate' => true];
        }
        try {
            if ($eventType === 'checkout_session.payment.paid') {
                $this->processPaidCheckout($payload, $event->id);
            } elseif ($eventType === 'checkout_session.payment.failed') {
                $checkoutId = data_get($payload, 'data.attributes.data.id');
                if (! is_string($checkoutId) || $checkoutId === '') {
                    throw new \RuntimeException('PayMongo checkout resource is missing');
                }
                DB::transaction(function () use ($checkoutId, $event): void {
                    DB::table('Payment')->where('providerCheckoutId', $checkoutId)
                        ->whereIn('status', ['PENDING', 'REQUIRES_ACTION'])->update([
                            'status' => 'FAILED', 'failureCode' => 'checkout_failed', 'updatedAt' => now(),
                        ]);
                    DB::table('OrderRevisionPurchase')->where('providerCheckoutId', $checkoutId)
                        ->whereIn('paymentStatus', ['PENDING', 'REQUIRES_ACTION'])->update([
                            'paymentStatus' => 'FAILED', 'failureCode' => 'checkout_failed', 'updatedAt' => now(),
                        ]);
                    DB::table('PaymentWebhookEvent')->where('id', $event->id)->update(['processedAt' => now(), 'processingError' => null]);
                });
            } elseif ($eventType === 'payment.refunded') {
                $resource = data_get($payload, 'data.attributes.data');
                $paymentId = data_get($resource, 'id');
                $refunds = data_get($resource, 'attributes.refunds');
                if (! is_string($paymentId) || ! is_array($refunds) || $refunds === []) {
                    throw new \RuntimeException('PayMongo refunded payment is missing provider refund evidence');
                }
                foreach ($refunds as $refund) {
                    $this->refunds->applyWebhookRefund($this->providerRefund($refund, $paymentId, data_get($resource, 'attributes.currency')));
                }
                DB::table('PaymentWebhookEvent')->where('id', $event->id)->update(['processedAt' => now(), 'processingError' => null]);
            } elseif ($eventType === 'payment.refund.updated') {
                $resource = data_get($payload, 'data.attributes.data');
                $paymentId = data_get($resource, 'attributes.payment_id');
                $this->refunds->applyWebhookRefund($this->providerRefund($resource, $paymentId, data_get($resource, 'attributes.currency')));
                DB::table('PaymentWebhookEvent')->where('id', $event->id)->update(['processedAt' => now(), 'processingError' => null]);
            } else {
                DB::table('PaymentWebhookEvent')->where('id', $event->id)->update(['processedAt' => now(), 'processingError' => null]);
            }
        } catch (\Throwable $error) {
            DB::table('PaymentWebhookEvent')->where('id', $event->id)->update([
                'processingError' => mb_substr($error->getMessage(), 0, 1000),
            ]);
            throw $error;
        }

        return ['received' => true, 'duplicate' => false];
    }

    private function extraRevisionContext(string $userId, string $orderId): array
    {
        $order = DB::table('Order as orders')->join('User as client', 'client.id', '=', 'orders.clientId')
            ->where('orders.id', $orderId)
            ->select('orders.*', 'client.displayName as clientName', 'client.email as clientEmail')->first();
        if (! $order) {
            throw $this->notFound('Order not found');
        }
        if ($order->clientId !== $userId) {
            throw $this->forbidden('Only the client can purchase an extra revision');
        }
        if ($order->status !== 'SUBMITTED') {
            throw $this->conflict('An extra revision is available only while reviewing submitted work');
        }
        if ((int) $order->revisionsUsed < (int) $order->revisionLimit) {
            throw $this->conflict('Use the remaining included revision before purchasing an extra revision');
        }
        $latest = DB::table('DeliverySubmission')->where('orderId', $orderId)->orderByDesc('version')->first();
        if ((int) ($order->reviewPolicyVersion ?? 0) !== 1 || ! $order->reviewDeadlineAt
            || now()->greaterThanOrEqualTo(CarbonImmutable::parse($order->reviewDeadlineAt))
            || ! $order->reviewDeliverySubmissionId || $latest?->id !== $order->reviewDeliverySubmissionId) {
            throw $this->conflict('The current delivery does not have an actionable review window');
        }
        if (DB::table('RevisionRequest')->where('orderId', $orderId)
            ->whereIn('status', ['OPEN', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT'])->exists()) {
            throw $this->conflict('Another revision request is already active');
        }
        if (DB::table('OrderDispute')->where('orderId', $orderId)
            ->whereIn('status', ['OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW'])->exists()) {
            throw $this->conflict('An active dispute blocks revision checkout');
        }
        $payments = DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->get();
        $payment = $payments->first();
        if ($payments->count() !== 1 || ! $payment || (int) $payment->refundedCentavos !== 0
            || DB::table('PaymentRefund')->where('paymentId', $payment->id)->where('status', 'SUCCEEDED')->exists()) {
            throw $this->conflict('A confirmed, unreimbursed order payment is required');
        }
        if ((int) $payment->providerNetCentavos !== (int) $order->subtotalCentavos
            || strtoupper($payment->currency) !== strtoupper($order->currency)) {
            throw new \RuntimeException('Order payment principal does not reconcile');
        }
        $duration = $order->pricingModel === 'SINGLE_PRICE_V2'
            ? $order->deliveryDurationMinutes
            : data_get(json_decode((string) $order->termsSnapshot, true), 'package.deliveryDays') * 1440;
        if (! is_numeric($duration) || (int) $duration <= 0) {
            throw $this->conflict('Paid extra revisions are unavailable because immutable delivery-duration evidence is missing');
        }
        $providerSubtotal = max(2000, $this->ceilRatio((int) $payment->providerNetCentavos, 1000, 10000));
        $platformFee = $this->ceilRatio($providerSubtotal, 500, 10000);

        return ['order' => $order, 'quote' => [
            'revisionType' => 'PAID_EXTRA', 'providerSubtotalCentavos' => $providerSubtotal,
            'platformFeeCentavos' => $platformFee, 'clientTotalCentavos' => $providerSubtotal + $platformFee,
            'currency' => strtoupper($payment->currency),
            'turnaroundMinutes' => min(4320, max(180, $this->ceilRatio((int) $duration, 50, 100))),
            'pricingPolicyVersion' => 1, 'pricingBasisCentavos' => (int) $payment->providerNetCentavos,
            'deliveryDurationBasisMinutes' => (int) $duration,
        ]];
    }

    private function ceilRatio(int $value, int $numerator, int $denominator): int
    {
        if ($value <= 0 || $numerator <= 0 || $denominator <= 0) {
            throw new \RuntimeException('Revision calculation inputs are invalid');
        }

        return intdiv(($value * $numerator) + $denominator - 1, $denominator);
    }

    private function publicRevisionPurchase(object $purchase): array
    {
        return [
            'id' => $purchase->id, 'orderId' => $purchase->orderId,
            'sourceDeliverySubmissionId' => $purchase->sourceDeliverySubmissionId,
            'revisionRequestId' => $purchase->revisionRequestId,
            'instructions' => $purchase->instructions,
            'providerSubtotalCentavos' => (int) $purchase->providerSubtotalCentavos,
            'platformFeeCentavos' => (int) $purchase->platformFeeCentavos,
            'totalCentavos' => (int) $purchase->totalCentavos, 'currency' => $purchase->currency,
            'turnaroundMinutes' => (int) $purchase->turnaroundMinutes,
            'pricingPolicyVersion' => (int) $purchase->pricingPolicyVersion,
            'paymentStatus' => $purchase->paymentStatus, 'activationStatus' => $purchase->activationStatus,
            'failureCode' => $purchase->failureCode,
            'paidAt' => $purchase->paidAt ? CarbonImmutable::parse($purchase->paidAt)->toISOString() : null,
            'activatedAt' => $purchase->activatedAt ? CarbonImmutable::parse($purchase->activatedAt)->toISOString() : null,
            'createdAt' => CarbonImmutable::parse($purchase->createdAt)->toISOString(),
        ];
    }

    private function providerRefund(mixed $resource, mixed $paymentId, mixed $paymentCurrency): array
    {
        $id = data_get($resource, 'id');
        $amount = data_get($resource, 'attributes.amount');
        $currency = strtoupper(trim((string) (data_get($resource, 'attributes.currency') ?? $paymentCurrency)));
        $status = data_get($resource, 'attributes.status');
        if (! is_string($id) || $id === '' || ! is_string($paymentId) || $paymentId === ''
            || ! is_int($amount) || $amount <= 0 || $currency === ''
            || ! in_array($status, ['pending', 'processing', 'succeeded', 'failed'], true)) {
            throw new \RuntimeException('PayMongo refund update is incomplete');
        }

        return [
            'id' => $id, 'paymentId' => $paymentId, 'amountCentavos' => $amount,
            'currency' => $currency, 'reason' => data_get($resource, 'attributes.reason', 'others'),
            'status' => $status,
            'createdAt' => is_int(data_get($resource, 'attributes.created_at'))
                ? CarbonImmutable::createFromTimestampUTC(data_get($resource, 'attributes.created_at')) : null,
            'updatedAt' => is_int(data_get($resource, 'attributes.updated_at'))
                ? CarbonImmutable::createFromTimestampUTC(data_get($resource, 'attributes.updated_at')) : null,
        ];
    }

    private function processPaidCheckout(array $payload, string $eventId): void
    {
        $checkoutId = data_get($payload, 'data.attributes.data.id');
        $providerPaymentId = data_get($payload, 'data.attributes.data.attributes.payments.0.id');
        $amount = data_get($payload, 'data.attributes.data.attributes.payments.0.attributes.amount');
        $currency = strtoupper(trim((string) data_get($payload, 'data.attributes.data.attributes.payments.0.attributes.currency')));
        $paidAt = data_get($payload, 'data.attributes.data.attributes.payments.0.attributes.paid_at');
        if (! is_string($checkoutId) || ! is_string($providerPaymentId) || ! is_int($amount) || $amount <= 0
            || ! is_int($paidAt) || $paidAt <= 0) {
            throw new \RuntimeException('PayMongo paid checkout contains incomplete payment evidence');
        }
        $payment = DB::table('Payment')->where('providerCheckoutId', $checkoutId)->first();
        $purchase = DB::table('OrderRevisionPurchase')->where('providerCheckoutId', $checkoutId)->first();
        if (! $payment && ! $purchase) {
            throw new \RuntimeException('Checkout session is not linked to a CampusGig payment');
        }
        if ($payment && $purchase) {
            throw new \RuntimeException('Checkout session has ambiguous CampusGig ownership');
        }
        $expectedAmount = $payment?->amountCentavos ?? $purchase->totalCentavos;
        $expectedCurrency = $payment?->currency ?? $purchase->currency;
        if ($amount !== (int) $expectedAmount || $currency !== strtoupper($expectedCurrency)) {
            throw new \RuntimeException('PayMongo payment does not match the order ledger');
        }
        $confirmedAt = CarbonImmutable::createFromTimestampUTC($paidAt);
        if ($payment) {
            $this->markPaid($payment, $providerPaymentId, $confirmedAt, $eventId);
        } else {
            $this->markRevisionPaid($purchase, $providerPaymentId, $confirmedAt, $eventId);
        }
    }

    private function markPaid(object $payment, string $providerPaymentId, CarbonImmutable $confirmedAt, ?string $eventId = null): void
    {
        DB::transaction(function () use ($payment, $providerPaymentId, $confirmedAt, $eventId): void {
            DB::table('Order')->where('id', $payment->orderId)->lockForUpdate()->first();
            $current = DB::table('Payment')->where('id', $payment->id)->first();
            if ($current->status === 'PAID') {
                if ($eventId) {
                    DB::table('PaymentWebhookEvent')->where('id', $eventId)->update(['processedAt' => now(), 'processingError' => null]);
                }

                return;
            }
            $changed = DB::table('Payment')->where('id', $payment->id)->whereIn('status', ['PENDING', 'REQUIRES_ACTION'])->update([
                'status' => 'PAID', 'providerPaymentId' => $providerPaymentId, 'paidAt' => $confirmedAt, 'updatedAt' => now(),
            ]);
            if ($changed !== 1) {
                throw new \RuntimeException('Payment changed before confirmation');
            }
            $order = DB::table('Order')->where('id', $payment->orderId)->first();
            $earningId = (string) Str::uuid();
            DB::table('ProviderEarning')->insert([
                'id' => $earningId, 'providerId' => $order->providerId, 'orderId' => $order->id,
                'paymentId' => $payment->id, 'revisionPurchaseId' => null, 'sourceType' => 'ORIGINAL_ORDER',
                'currency' => $order->currency, 'grossServiceAmountCentavos' => $order->subtotalCentavos,
                'status' => 'PENDING', 'pendingAt' => $confirmedAt, 'createdAt' => $confirmedAt, 'updatedAt' => $confirmedAt,
            ]);
            DB::table('ProviderEarningLedgerEntry')->insert([
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $order->providerId,
                'orderId' => $order->id, 'sourcePaymentId' => $payment->id, 'sourceRevisionPurchaseId' => null,
                'type' => 'EARNING_PENDING_CREDIT', 'amountCentavos' => $order->subtotalCentavos,
                'currency' => $order->currency, 'sourceKey' => "payment:{$payment->id}:earning-pending-credit", 'createdAt' => $confirmedAt,
            ]);
            if ($order->pricingModel === 'SINGLE_PRICE_V2') {
                if (! is_numeric($order->deliveryDurationMinutes) || (int) $order->deliveryDurationMinutes <= 0 || $order->dueAt !== null) {
                    throw new \RuntimeException('V2 order delivery deadline evidence is invalid');
                }
                DB::table('Order')->where('id', $order->id)->whereNull('dueAt')->update([
                    'dueAt' => $confirmedAt->addMinutes((int) $order->deliveryDurationMinutes), 'updatedAt' => now(),
                ]);
            }
            foreach ([$order->clientId, $order->providerId] as $recipientId) {
                DB::table('Notification')->insert([
                    'id' => (string) Str::uuid(), 'recipientId' => $recipientId, 'orderId' => $order->id,
                    'type' => 'ORDER_PAYMENT_RECEIVED', 'title' => 'Order payment confirmed',
                    'body' => "Payment for {$order->titleSnapshot} was confirmed by PayMongo.", 'createdAt' => $confirmedAt,
                ]);
            }
            if ($eventId) {
                DB::table('PaymentWebhookEvent')->where('id', $eventId)->update(['processedAt' => now(), 'processingError' => null]);
            }
        });
    }

    private function markRevisionPaid(object $purchase, string $providerPaymentId, CarbonImmutable $confirmedAt, ?string $eventId = null): void
    {
        DB::transaction(function () use ($purchase, $providerPaymentId, $confirmedAt, $eventId): void {
            DB::table('Order')->where('id', $purchase->orderId)->lockForUpdate()->first();
            $current = DB::table('OrderRevisionPurchase')->where('id', $purchase->id)->first();
            if ($current->paymentStatus === 'PAID') {
                if ($eventId) {
                    DB::table('PaymentWebhookEvent')->where('id', $eventId)->update(['processedAt' => now(), 'processingError' => null]);
                }

                return;
            }
            $paid = DB::table('OrderRevisionPurchase')->where('id', $current->id)
                ->whereIn('paymentStatus', ['PENDING', 'REQUIRES_ACTION'])->update([
                    'paymentStatus' => 'PAID', 'providerPaymentId' => $providerPaymentId,
                    'paidAt' => $confirmedAt, 'updatedAt' => now(),
                ]);
            if ($paid !== 1) {
                throw $this->conflict('The extra-revision payment changed before confirmation');
            }
            $order = DB::table('Order')->where('id', $purchase->orderId)->first();
            $latest = DB::table('DeliverySubmission')->where('orderId', $order->id)->orderByDesc('version')->first();
            $activeRevision = DB::table('RevisionRequest')->where('orderId', $order->id)
                ->whereIn('status', ['OPEN', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT'])->exists();
            $activeDispute = DB::table('OrderDispute')->where('orderId', $order->id)
                ->whereIn('status', ['OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW'])->exists();
            $canActivate = $order->status === 'SUBMITTED'
                && (int) $order->revisionsUsed >= (int) $order->revisionLimit
                && (int) ($order->reviewPolicyVersion ?? 0) === 1
                && $order->reviewDeadlineAt
                && CarbonImmutable::parse($order->reviewDeadlineAt)->greaterThan($confirmedAt)
                && $order->reviewDeliverySubmissionId === $current->sourceDeliverySubmissionId
                && $latest?->id === $current->sourceDeliverySubmissionId
                && ! $activeRevision && ! $activeDispute;
            if (! $canActivate) {
                DB::table('OrderRevisionPurchase')->where('id', $current->id)->update([
                    'activationStatus' => 'RECONCILIATION_REQUIRED',
                    'failureCode' => 'stale_order_state_after_payment', 'updatedAt' => now(),
                ]);
                if ($eventId) {
                    DB::table('PaymentWebhookEvent')->where('id', $eventId)->update(['processedAt' => now(), 'processingError' => null]);
                }

                return;
            }
            $revisionId = (string) Str::uuid();
            $sequence = ((int) (DB::table('RevisionRequest')->where('orderId', $order->id)->max('sequenceNumber') ?? 0)) + 1;
            DB::table('RevisionRequest')->insert([
                'id' => $revisionId, 'orderId' => $order->id, 'requestedBy' => $order->clientId,
                'sequenceNumber' => $sequence, 'type' => 'PAID_EXTRA', 'instructions' => $current->instructions,
                'status' => 'OPEN', 'sourceDeliverySubmissionId' => $current->sourceDeliverySubmissionId,
                'revisionDeadlineAt' => $confirmedAt->addMinutes((int) $current->turnaroundMinutes),
                'turnaroundMinutes' => $current->turnaroundMinutes, 'createdAt' => $confirmedAt,
            ]);
            $changed = DB::table('Order')->where('id', $order->id)->where('status', 'SUBMITTED')
                ->where('reviewDeliverySubmissionId', $current->sourceDeliverySubmissionId)->update([
                    'status' => 'REVISION_REQUESTED', 'reviewPolicyVersion' => null,
                    'reviewStartedAt' => null, 'reviewDeadlineAt' => null,
                    'reviewDeliverySubmissionId' => null, 'updatedAt' => now(),
                ]);
            if ($changed !== 1) {
                throw $this->conflict('The order changed before the paid revision could activate');
            }
            DB::table('OrderRevisionPurchase')->where('id', $current->id)->update([
                'revisionRequestId' => $revisionId, 'activationStatus' => 'ACTIVATED',
                'activatedAt' => $confirmedAt, 'failureCode' => null, 'updatedAt' => now(),
            ]);
            $earningId = (string) Str::uuid();
            DB::table('ProviderEarning')->insert([
                'id' => $earningId, 'providerId' => $order->providerId, 'orderId' => $order->id,
                'paymentId' => null, 'revisionPurchaseId' => $current->id, 'sourceType' => 'PAID_EXTRA_REVISION',
                'currency' => $current->currency, 'grossServiceAmountCentavos' => $current->providerSubtotalCentavos,
                'status' => 'PENDING', 'pendingAt' => $confirmedAt, 'createdAt' => $confirmedAt, 'updatedAt' => $confirmedAt,
            ]);
            DB::table('ProviderEarningLedgerEntry')->insert([
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $order->providerId,
                'orderId' => $order->id, 'sourcePaymentId' => null, 'sourceRevisionPurchaseId' => $current->id,
                'type' => 'EARNING_PENDING_CREDIT', 'amountCentavos' => $current->providerSubtotalCentavos,
                'currency' => $current->currency, 'sourceKey' => "revision-purchase:{$current->id}:earning-pending-credit",
                'createdAt' => $confirmedAt,
            ]);
            DB::table('OrderStatusHistory')->insert([
                'id' => (string) Str::uuid(), 'orderId' => $order->id, 'fromStatus' => 'SUBMITTED',
                'toStatus' => 'REVISION_REQUESTED', 'changedBy' => $order->clientId,
                'note' => "Paid extra revision {$sequence} activated", 'createdAt' => $confirmedAt,
            ]);
            foreach ([$order->providerId, $order->clientId] as $recipientId) {
                DB::table('Notification')->insert([
                    'id' => (string) Str::uuid(), 'recipientId' => $recipientId, 'orderId' => $order->id,
                    'type' => 'PAID_EXTRA_REVISION_ACTIVATED', 'title' => $recipientId === $order->providerId
                        ? 'Paid extra revision activated' : 'Extra revision payment confirmed',
                    'body' => $recipientId === $order->providerId
                        ? "An extra revision for {$order->titleSnapshot} was paid and is ready for your work."
                        : "Your extra revision for {$order->titleSnapshot} is now active.",
                    'createdAt' => $confirmedAt,
                ]);
            }
            if ($eventId) {
                DB::table('PaymentWebhookEvent')->where('id', $eventId)->update(['processedAt' => now(), 'processingError' => null]);
            }
        });
    }

    private function reconcilePendingPayment(string $orderId): void
    {
        if (! Cache::add("payment-reconciliation:{$orderId}", true, 5)) {
            return;
        }
        try {
            $payment = DB::table('Payment')->where('orderId', $orderId)
                ->whereIn('status', ['PENDING', 'REQUIRES_ACTION'])->whereNotNull('providerCheckoutId')
                ->orderByDesc('createdAt')->first();
            if (! $payment) {
                return;
            }
            $paid = $this->paymongo->paidCheckout($payment->providerCheckoutId);
            if (! $paid) {
                return;
            }
            if ($paid['amountCentavos'] !== (int) $payment->amountCentavos
                || $paid['currency'] !== strtoupper($payment->currency)) {
                throw new \RuntimeException('PayMongo payment does not match the order ledger');
            }
            $this->markPaid($payment, $paid['id'], $paid['paidAt']);
        } catch (\Throwable) {
            // Signed webhooks remain authoritative; a later read retries safe reconciliation.
        }
    }

    private function reconcilePendingRevisionPurchases(string $orderId): void
    {
        if (! Cache::add("revision-payment-reconciliation:{$orderId}", true, 5)) {
            return;
        }
        try {
            $purchases = DB::table('OrderRevisionPurchase')->where('orderId', $orderId)
                ->whereIn('paymentStatus', ['PENDING', 'REQUIRES_ACTION'])->whereNotNull('providerCheckoutId')
                ->orderBy('createdAt')->limit(5)->get();
            foreach ($purchases as $purchase) {
                $paid = $this->paymongo->paidCheckout($purchase->providerCheckoutId);
                if (! $paid) {
                    continue;
                }
                if ($paid['amountCentavos'] !== (int) $purchase->totalCentavos
                    || $paid['currency'] !== strtoupper($purchase->currency)) {
                    throw new \RuntimeException('PayMongo payment does not match the revision ledger');
                }
                $this->markRevisionPaid($purchase, $paid['id'], $paid['paidAt']);
            }
        } catch (\Throwable) {
            // Signed webhooks remain authoritative; a later read retries safe reconciliation.
        }
    }

    private function recordWebhook(string $providerEventId, string $eventType, array $payload): array
    {
        try {
            $id = (string) Str::uuid();
            DB::table('PaymentWebhookEvent')->insert([
                'id' => $id, 'provider' => 'PAYMONGO', 'providerEventId' => $providerEventId,
                'eventType' => $eventType, 'payload' => json_encode($payload, JSON_THROW_ON_ERROR), 'createdAt' => now(),
            ]);

            return [DB::table('PaymentWebhookEvent')->where('id', $id)->first(), false];
        } catch (QueryException $error) {
            if (! in_array((string) $error->getCode(), ['23000', '23505'], true)) {
                throw $error;
            }

            return [DB::table('PaymentWebhookEvent')->where('provider', 'PAYMONGO')->where('providerEventId', $providerEventId)->first(), true];
        }
    }

    private function publicPayment(object $payment, array $refunds = []): array
    {
        return [
            'id' => $payment->id, 'provider' => $payment->provider,
            'amountCentavos' => (int) $payment->amountCentavos,
            'platformFeeCentavos' => (int) $payment->platformFeeCentavos,
            'providerNetCentavos' => (int) $payment->providerNetCentavos,
            'refundedCentavos' => (int) $payment->refundedCentavos,
            'currency' => $payment->currency, 'status' => $payment->status,
            'paidAt' => $payment->paidAt ? CarbonImmutable::parse($payment->paidAt)->toISOString() : null,
            'createdAt' => CarbonImmutable::parse($payment->createdAt)->toISOString(),
            'refunds' => $refunds,
        ];
    }

    private function participantOrder(string $userId, string $orderId): object
    {
        $order = DB::table('Order')->where('id', $orderId)
            ->where(fn ($query) => $query->where('clientId', $userId)->orWhere('providerId', $userId))->first();
        if (! $order) {
            throw $this->notFound('Order not found');
        }

        return $order;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return $this->error(400, 'Bad Request', $message);
    }

    private function forbidden(string $message): HttpResponseException
    {
        return $this->error(403, 'Forbidden', $message);
    }

    private function notFound(string $message): HttpResponseException
    {
        return $this->error(404, 'Not Found', $message);
    }

    private function conflict(string $message): HttpResponseException
    {
        return $this->error(409, 'Conflict', $message);
    }

    private function badGateway(string $message): HttpResponseException
    {
        return $this->error(502, 'Bad Gateway', $message);
    }

    private function error(int $status, string $error, string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $error, 'statusCode' => $status], $status));
    }
}
