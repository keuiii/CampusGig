<?php

namespace App\Services\Payments;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RefundService
{
    private const ACTIVE_STATUSES = ['REQUESTED', 'PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED'];

    public function __construct(private readonly PaymongoClient $paymongo) {}

    public function eligibility(string $userId, string $orderId): array
    {
        $order = $this->participantOrder($userId, $orderId);
        $payment = DB::table('Payment')->where('orderId', $orderId)
            ->whereIn('status', ['PAID', 'REFUND_PENDING', 'REFUNDED'])->orderByDesc('createdAt')->first();
        $refund = $payment ? DB::table('PaymentRefund')->where('paymentId', $payment->id)
            ->whereNotNull('sourceKey')->whereIn('status', [...self::ACTIVE_STATUSES, 'SUCCEEDED'])
            ->orderByDesc('createdAt')->first() : null;
        $noDelivery = ! DB::table('DeliverySubmission')->where('orderId', $orderId)->exists();
        $paidNotStarted = $order->clientId === $userId && $payment?->status === 'PAID'
            && $order->status === 'ACCEPTED' && $order->startedAt === null && $noDelivery && ! $refund;
        $missedRush = $order->clientId === $userId && $payment?->status === 'PAID'
            && $order->pricingModel === 'SINGLE_PRICE_V2' && filled($order->deliveryOption)
            && $order->deliveryOption !== 'NORMAL' && $order->dueAt
            && CarbonImmutable::parse($order->dueAt)->isPast()
            && in_array($order->status, ['ACCEPTED', 'IN_PROGRESS'], true) && $noDelivery && ! $refund;

        return ['data' => [
            'canRequest' => $paidNotStarted || $missedRush,
            'eligibleReasons' => array_values(array_filter([
                $paidNotStarted ? 'PAID_NOT_STARTED' : null,
                $missedRush ? 'MISSED_RUSH_DEADLINE' : null,
            ])),
            'sourceType' => $payment ? 'ORIGINAL_ORDER' : null,
            'payment' => $payment ? [
                'id' => $payment->id, 'providerPrincipalCentavos' => (int) $payment->providerNetCentavos,
                'platformFeeCentavos' => (int) $payment->platformFeeCentavos,
                'refundTotalCentavos' => (int) $payment->amountCentavos,
                'currency' => $payment->currency, 'status' => $payment->status,
            ] : null,
            'refund' => $refund ? self::publicRefund($refund) : null,
        ]];
    }

    public function request(string $clientId, string $orderId, string $reason): array
    {
        if (! in_array($reason, ['PAID_NOT_STARTED', 'MISSED_RUSH_DEADLINE'], true)) {
            throw $this->badRequest('This refund reason is not client-requestable');
        }
        $refund = DB::transaction(function () use ($clientId, $orderId, $reason): object {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $order = DB::table('Order')->where('id', $orderId)->where('clientId', $clientId)->first();
            if (! $order) {
                throw $this->forbidden('Only the client can request this refund');
            }
            $payment = DB::table('Payment')->where('orderId', $orderId)
                ->whereIn('status', ['PAID', 'REFUND_PENDING', 'REFUNDED'])->orderByDesc('createdAt')->first();
            if (! $payment?->providerPaymentId) {
                throw $this->conflict('A confirmed payment with recognized provider earnings is required');
            }
            $sourceKey = "refund:ORIGINAL_ORDER:{$payment->id}:{$reason}";
            $existing = DB::table('PaymentRefund')->where('sourceKey', $sourceKey)->first();
            if ($existing) {
                return $existing;
            }
            $noDelivery = ! DB::table('DeliverySubmission')->where('orderId', $orderId)->exists();
            if ($reason === 'PAID_NOT_STARTED'
                && ($order->status !== 'ACCEPTED' || $order->startedAt !== null || ! $noDelivery)) {
                throw $this->conflict('This order is no longer eligible for a paid-not-started refund');
            }
            if ($reason === 'MISSED_RUSH_DEADLINE'
                && ($order->pricingModel !== 'SINGLE_PRICE_V2' || blank($order->deliveryOption)
                    || $order->deliveryOption === 'NORMAL' || ! $order->dueAt
                    || ! CarbonImmutable::parse($order->dueAt)->isPast()
                    || ! in_array($order->status, ['ACCEPTED', 'IN_PROGRESS'], true) || ! $noDelivery)) {
                throw $this->conflict('The rush deadline has not been missed or delivery has already occurred');
            }
            if ($payment->status !== 'PAID') {
                throw $this->conflict('This payment is not eligible for a new refund request');
            }
            if (DB::table('PaymentRefund')->where('paymentId', $payment->id)->whereNotNull('sourceKey')
                ->whereIn('status', [...self::ACTIVE_STATUSES, 'SUCCEEDED'])->exists()) {
                throw $this->conflict('This economic purchase already has an active or completed full refund');
            }
            $earning = DB::table('ProviderEarning')->where('paymentId', $payment->id)->first();
            if (! $earning) {
                throw $this->conflict('A confirmed payment with recognized provider earnings is required');
            }
            if (in_array($earning->status, ['PAID_OUT', 'PAYOUT_PROCESSING', 'REFUNDED'], true)) {
                throw $this->conflict('This earning cannot be refunded without payout-aware recovery');
            }
            $preStatus = $earning->status;
            if ($preStatus !== 'FROZEN') {
                DB::table('ProviderEarning')->where('id', $earning->id)->update(['status' => 'FROZEN', 'updatedAt' => now()]);
                DB::table('ProviderEarningLedgerEntry')->insert([
                    'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id,
                    'providerId' => $order->providerId, 'orderId' => $orderId, 'type' => 'EARNING_FROZEN',
                    'amountCentavos' => 0, 'currency' => $payment->currency,
                    'sourceKey' => "earning:{$earning->id}:refund:{$sourceKey}:frozen", 'createdAt' => now(),
                ]);
            }
            DB::table('Payment')->where('id', $payment->id)->update(['status' => 'REFUND_PENDING', 'updatedAt' => now()]);
            DB::table('Order')->where('id', $orderId)->update(['status' => 'CANCELLED', 'updatedAt' => now()]);
            DB::table('OrderStatusHistory')->insert([
                'id' => (string) Str::uuid(), 'orderId' => $orderId, 'fromStatus' => $order->status,
                'toStatus' => 'CANCELLED', 'changedBy' => $clientId,
                'note' => "Full refund requested: {$reason}", 'createdAt' => now(),
            ]);
            $id = (string) Str::uuid();
            $now = now();
            DB::table('PaymentRefund')->insert([
                'id' => $id, 'orderId' => $orderId, 'paymentId' => $payment->id,
                'providerEarningId' => $earning->id, 'requestedById' => $clientId,
                'sourceType' => 'ORIGINAL_ORDER', 'reasonCode' => $reason, 'requestOrigin' => 'CLIENT',
                'preRefundEarningStatus' => $preStatus, 'sourceKey' => $sourceKey,
                'idempotencyKey' => 'refund:'.Str::uuid(),
                'providerPrincipalCentavos' => $payment->providerNetCentavos,
                'platformFeeCentavos' => $payment->platformFeeCentavos,
                'refundTotalCentavos' => $payment->amountCentavos, 'amountCentavos' => $payment->amountCentavos,
                'currency' => $payment->currency, 'reason' => $reason, 'status' => 'REQUESTED',
                'providerPrincipalReversedCentavos' => 0, 'platformFeeReversedCentavos' => 0,
                'requestedAt' => $now, 'createdAt' => $now, 'updatedAt' => $now,
            ]);
            $this->notify($order->clientId, $orderId, 'ORDER_REFUND_REQUESTED', 'Full refund requested',
                "Your full refund request for {$order->titleSnapshot} is being processed.");
            $this->notify($order->providerId, $orderId, 'ORDER_REFUND_REQUESTED', 'Earning frozen for refund',
                "The affected earning for {$order->titleSnapshot} is frozen while a full refund is processed.");

            return DB::table('PaymentRefund')->where('id', $id)->first();
        });

        return $this->submit($refund->id);
    }

    public function requestFromDispute(string $adminId, string $disputeId): array
    {
        $dispute = DB::table('OrderDispute')->where('id', $disputeId)->first();
        if (! $dispute) {
            throw $this->notFound('Dispute not found');
        }
        if ($dispute->status !== 'RESOLVED_CLIENT') {
            throw $this->conflict('A refund requires a final client-favoring dispute resolution');
        }
        $sourceType = $dispute->targetRevisionPurchaseId ? 'PAID_EXTRA_REVISION' : 'ORIGINAL_ORDER';
        $refund = $this->prepareAdminRefund($adminId, $dispute->orderId, $sourceType,
            $dispute->targetRevisionPurchaseId, 'DISPUTE_CLIENT_WIN', $disputeId, null);

        return $this->submit($refund->id);
    }

    public function remediateStaleRevision(string $adminId, string $revisionPurchaseId): array
    {
        $purchase = DB::table('OrderRevisionPurchase')->where('id', $revisionPurchaseId)->first();
        if (! $purchase) {
            throw $this->notFound('Revision purchase not found');
        }
        $refund = $this->prepareAdminRefund($adminId, $purchase->orderId, 'PAID_EXTRA_REVISION',
            $revisionPurchaseId, 'STALE_REVISION_PAYMENT', null, null);

        return $this->submit($refund->id);
    }

    public function requestAdminException(string $adminId, string $sourceType, string $sourceId, string $policyNote): array
    {
        $orderId = $sourceType === 'ORIGINAL_ORDER'
            ? DB::table('Payment')->where('id', $sourceId)->value('orderId')
            : DB::table('OrderRevisionPurchase')->where('id', $sourceId)->value('orderId');
        if (! is_string($orderId)) {
            throw $this->notFound('Refund source not found');
        }
        $refund = $this->prepareAdminRefund($adminId, $orderId, $sourceType, $sourceId,
            'ADMIN_EXCEPTION', null, trim($policyNote));

        return $this->submit($refund->id);
    }

    public function adminList(?string $status, int $limit): array
    {
        $query = DB::table('PaymentRefund')->whereNotNull('sourceKey');
        if ($status) {
            $query->where('status', $status);
        }

        return ['data' => $query->orderByDesc('updatedAt')->orderByDesc('id')
            ->limit(min(max($limit, 1), 100))->get()
            ->map(fn (object $refund): array => $this->adminRefund($refund))->all()];
    }

    public function detail(string $refundId): array
    {
        $refund = DB::table('PaymentRefund')->where('id', $refundId)->first();
        if (! $refund) {
            throw $this->notFound('Refund not found');
        }

        return ['data' => $this->adminRefund($refund)];
    }

    public function reconcile(string $refundId): array
    {
        $refund = DB::table('PaymentRefund')->where('id', $refundId)->first();
        if (! $refund) {
            throw $this->notFound('Refund not found');
        }
        if (in_array($refund->status, ['SUCCEEDED', 'FAILED'], true)) {
            return $this->detail($refundId);
        }
        if (! $refund->providerRefundId) {
            throw $this->conflict('The provider refund identifier is unknown. Do not retry creation; reconcile this attempt in PayMongo first.');
        }
        try {
            $this->apply($refundId, $this->paymongo->retrieveRefund($refund->providerRefundId));
        } catch (PaymongoRefundException $error) {
            throw $this->badGateway($error->getMessage());
        }

        return $this->detail($refundId);
    }

    public function staleRevisionList(): array
    {
        $purchases = DB::table('OrderRevisionPurchase as purchases')
            ->join('Order as orders', 'orders.id', '=', 'purchases.orderId')
            ->where('purchases.paymentStatus', 'PAID')
            ->where('purchases.activationStatus', 'RECONCILIATION_REQUIRED')
            ->whereNotExists(function ($query): void {
                $query->selectRaw('1')->from('PaymentRefund as refunds')
                    ->whereColumn('refunds.revisionPurchaseId', 'purchases.id')
                    ->whereNotNull('refunds.sourceKey')
                    ->whereIn('refunds.status', [...self::ACTIVE_STATUSES, 'SUCCEEDED']);
            })
            ->orderBy('purchases.paidAt')->orderBy('purchases.id')->limit(50)
            ->get(['purchases.*', 'orders.orderNumber', 'orders.titleSnapshot']);

        return ['data' => $purchases->map(fn (object $purchase): array => [
            'id' => $purchase->id, 'orderId' => $purchase->orderId,
            'providerSubtotalCentavos' => (int) $purchase->providerSubtotalCentavos,
            'platformFeeCentavos' => (int) $purchase->platformFeeCentavos,
            'totalCentavos' => (int) $purchase->totalCentavos, 'currency' => $purchase->currency,
            'paidAt' => $purchase->paidAt ? CarbonImmutable::parse($purchase->paidAt)->toISOString() : null,
            'failureCode' => $purchase->failureCode,
            'order' => ['orderNumber' => $purchase->orderNumber, 'titleSnapshot' => $purchase->titleSnapshot],
        ])->all()];
    }

    private function prepareAdminRefund(
        string $adminId,
        string $orderId,
        string $sourceType,
        ?string $sourceId,
        string $reason,
        ?string $disputeId,
        ?string $policyNote,
    ): object {
        return DB::transaction(function () use ($adminId, $orderId, $sourceType, $sourceId, $reason, $disputeId, $policyNote): object {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $order = DB::table('Order')->where('id', $orderId)->first();
            if (! $order) {
                throw $this->notFound('Order not found');
            }
            if ($reason === 'ADMIN_EXCEPTION' && ((! $policyNote || mb_strlen($policyNote) < 20)
                || $order->status === 'COMPLETED'
                || DB::table('DeliverySubmission')->where('orderId', $orderId)->exists())) {
                throw $this->conflict('Admin exceptions require a documented policy basis before delivery or completion');
            }

            $existing = DB::table('PaymentRefund')->where('orderId', $orderId)
                ->where('sourceType', $sourceType)->where('reasonCode', $reason)
                ->when($sourceType === 'ORIGINAL_ORDER',
                    fn ($query) => $sourceId ? $query->where('paymentId', $sourceId) : $query->whereNotNull('paymentId'),
                    fn ($query) => $query->where('revisionPurchaseId', $sourceId))
                ->whereNotNull('sourceKey')->orderByDesc('createdAt')->first();
            if ($existing) {
                return $existing;
            }
            $target = $this->refundTarget($orderId, $sourceType, $sourceId, $reason);
            $blocking = DB::table('PaymentRefund')
                ->when($target['paymentId'], fn ($query, $id) => $query->where('paymentId', $id),
                    fn ($query) => $query->where('revisionPurchaseId', $target['revisionPurchaseId']))
                ->whereNotNull('sourceKey')->whereIn('status', [...self::ACTIVE_STATUSES, 'SUCCEEDED'])->exists();
            if ($blocking) {
                throw $this->conflict('This economic purchase already has an active or completed full refund');
            }
            $earning = $target['earning'];
            if (in_array($earning->status, ['PAID_OUT', 'PAYOUT_PROCESSING', 'REFUNDED'], true)) {
                throw $this->conflict('This earning cannot be refunded without payout-aware recovery');
            }
            $preStatus = $earning->status;
            $sourceKey = "refund:{$sourceType}:{$target['sourceId']}:{$reason}";
            if ($preStatus !== 'FROZEN') {
                DB::table('ProviderEarning')->where('id', $earning->id)->update(['status' => 'FROZEN', 'updatedAt' => now()]);
                DB::table('ProviderEarningLedgerEntry')->insert([
                    'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id,
                    'providerId' => $order->providerId, 'orderId' => $orderId, 'type' => 'EARNING_FROZEN',
                    'amountCentavos' => 0, 'currency' => $target['currency'],
                    'sourceKey' => "earning:{$earning->id}:refund:{$sourceKey}:frozen", 'createdAt' => now(),
                ]);
            }
            if ($target['paymentId']) {
                DB::table('Payment')->where('id', $target['paymentId'])->update(['status' => 'REFUND_PENDING', 'updatedAt' => now()]);
            } else {
                DB::table('OrderRevisionPurchase')->where('id', $target['revisionPurchaseId'])
                    ->update(['paymentStatus' => 'REFUND_PENDING', 'updatedAt' => now()]);
            }
            $id = (string) Str::uuid();
            $at = now();
            DB::table('PaymentRefund')->insert([
                'id' => $id, 'orderId' => $orderId, 'paymentId' => $target['paymentId'],
                'revisionPurchaseId' => $target['revisionPurchaseId'], 'providerEarningId' => $earning->id,
                'triggeringDisputeId' => $disputeId, 'requestedById' => $adminId,
                'sourceType' => $sourceType, 'reasonCode' => $reason, 'requestOrigin' => 'ADMIN',
                'preRefundEarningStatus' => $preStatus, 'sourceKey' => $sourceKey,
                'idempotencyKey' => 'refund:'.Str::uuid(),
                'providerPrincipalCentavos' => $target['providerPrincipalCentavos'],
                'platformFeeCentavos' => $target['platformFeeCentavos'],
                'refundTotalCentavos' => $target['refundTotalCentavos'],
                'amountCentavos' => $target['refundTotalCentavos'], 'currency' => $target['currency'],
                'reason' => $policyNote ? "{$reason}: {$policyNote}" : $reason, 'status' => 'REQUESTED',
                'providerPrincipalReversedCentavos' => 0, 'platformFeeReversedCentavos' => 0,
                'requestedAt' => $at, 'createdAt' => $at, 'updatedAt' => $at,
            ]);
            $this->notify($order->clientId, $orderId, 'ORDER_REFUND_REQUESTED', 'Full refund requested',
                "Your full refund request for {$order->titleSnapshot} is being processed.");
            $this->notify($order->providerId, $orderId, 'ORDER_REFUND_REQUESTED', 'Earning frozen for refund',
                "The affected earning for {$order->titleSnapshot} is frozen while a full refund is processed.");

            return DB::table('PaymentRefund')->where('id', $id)->first();
        });
    }

    /** @return array<string, mixed> */
    private function refundTarget(string $orderId, string $sourceType, ?string $sourceId, string $reason): array
    {
        if ($sourceType === 'ORIGINAL_ORDER') {
            $payment = DB::table('Payment')->where('orderId', $orderId)
                ->when($sourceId, fn ($query, $id) => $query->where('id', $id))
                ->where('status', 'PAID')->orderByDesc('paidAt')->first();
            $earning = $payment ? DB::table('ProviderEarning')->where('paymentId', $payment->id)->first() : null;
            if (! $payment?->providerPaymentId || ! $earning) {
                throw $this->conflict('A confirmed payment with recognized provider earnings is required');
            }

            return ['sourceId' => $payment->id, 'paymentId' => $payment->id, 'revisionPurchaseId' => null,
                'providerPaymentId' => $payment->providerPaymentId, 'earning' => $earning,
                'providerPrincipalCentavos' => (int) $payment->providerNetCentavos,
                'platformFeeCentavos' => (int) $payment->platformFeeCentavos,
                'refundTotalCentavos' => (int) $payment->amountCentavos, 'currency' => $payment->currency];
        }
        if ($sourceType !== 'PAID_EXTRA_REVISION' || ! $sourceId) {
            throw $this->badRequest('A revision purchase is required');
        }
        $purchase = DB::table('OrderRevisionPurchase')->where('id', $sourceId)->where('orderId', $orderId)
            ->where('paymentStatus', 'PAID')->first();
        if (! $purchase?->providerPaymentId) {
            throw $this->conflict('A confirmed revision payment is required');
        }
        if ($reason === 'STALE_REVISION_PAYMENT' && $purchase->activationStatus !== 'RECONCILIATION_REQUIRED') {
            throw $this->conflict('Only a stale paid revision can use this remediation path');
        }
        $earning = DB::table('ProviderEarning')->where('revisionPurchaseId', $purchase->id)->first();
        if (! $earning && $reason === 'STALE_REVISION_PAYMENT') {
            $earningId = (string) Str::uuid();
            $at = $purchase->paidAt ?? now();
            DB::table('ProviderEarning')->insert([
                'id' => $earningId, 'providerId' => $purchase->providerId, 'orderId' => $purchase->orderId,
                'paymentId' => null, 'revisionPurchaseId' => $purchase->id, 'sourceType' => 'PAID_EXTRA_REVISION',
                'currency' => $purchase->currency, 'grossServiceAmountCentavos' => $purchase->providerSubtotalCentavos,
                'status' => 'FROZEN', 'pendingAt' => $at, 'availableAt' => null, 'createdAt' => $at, 'updatedAt' => now(),
            ]);
            DB::table('ProviderEarningLedgerEntry')->insert([
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $purchase->providerId,
                'orderId' => $purchase->orderId, 'sourcePaymentId' => null, 'sourceRevisionPurchaseId' => $purchase->id,
                'type' => 'EARNING_PENDING_CREDIT', 'amountCentavos' => $purchase->providerSubtotalCentavos,
                'currency' => $purchase->currency, 'sourceKey' => "revision-purchase:{$purchase->id}:earning-pending-credit",
                'createdAt' => $at,
            ]);
            $earning = DB::table('ProviderEarning')->where('id', $earningId)->first();
        }
        if (! $earning) {
            throw $this->conflict('Revision earning recognition is missing');
        }

        return ['sourceId' => $purchase->id, 'paymentId' => null, 'revisionPurchaseId' => $purchase->id,
            'providerPaymentId' => $purchase->providerPaymentId, 'earning' => $earning,
            'providerPrincipalCentavos' => (int) $purchase->providerSubtotalCentavos,
            'platformFeeCentavos' => (int) $purchase->platformFeeCentavos,
            'refundTotalCentavos' => (int) $purchase->totalCentavos, 'currency' => $purchase->currency];
    }

    private function submit(string $refundId): array
    {
        $claimed = DB::table('PaymentRefund')->where('id', $refundId)->where('status', 'REQUESTED')
            ->update(['status' => 'PROCESSING', 'updatedAt' => now()]);
        if ($claimed !== 1) {
            return ['data' => self::publicRefund(DB::table('PaymentRefund')->where('id', $refundId)->first())];
        }
        $refund = DB::table('PaymentRefund')->where('id', $refundId)->first();
        $providerPaymentId = $refund->paymentId
            ? DB::table('Payment')->where('id', $refund->paymentId)->value('providerPaymentId')
            : DB::table('OrderRevisionPurchase')->where('id', $refund->revisionPurchaseId)->value('providerPaymentId');
        if (! is_string($providerPaymentId) || ! $refund->refundTotalCentavos) {
            throw $this->conflict('Refund source evidence is incomplete');
        }
        try {
            $provider = $this->paymongo->createRefund([
                'amountCentavos' => (int) $refund->refundTotalCentavos,
                'paymentId' => $providerPaymentId, 'idempotencyKey' => $refund->idempotencyKey,
                'notes' => "CampusGig {$refund->reasonCode} {$refund->id}",
            ]);
            $this->apply($refundId, $provider);
        } catch (PaymongoRefundException $error) {
            $status = $error->outcome === 'REJECTED' ? 'FAILED' : 'RECONCILIATION_REQUIRED';
            $this->submissionFailure($refundId, $status, $error->providerCode ?? $error->getMessage());
            throw $this->badGateway($error->getMessage());
        }

        return ['data' => self::publicRefund(DB::table('PaymentRefund')->where('id', $refundId)->first())];
    }

    public function applyWebhookRefund(array $provider): void
    {
        $refund = DB::table('PaymentRefund')->where('providerRefundId', $provider['id'])->first();
        if (! $refund) {
            $candidates = DB::table('PaymentRefund as refunds')
                ->leftJoin('Payment as payments', 'payments.id', '=', 'refunds.paymentId')
                ->leftJoin('OrderRevisionPurchase as purchases', 'purchases.id', '=', 'refunds.revisionPurchaseId')
                ->whereNull('refunds.providerRefundId')
                ->where('refunds.amountCentavos', $provider['amountCentavos'])
                ->where(fn ($query) => $query->where('payments.providerPaymentId', $provider['paymentId'])
                    ->orWhere('purchases.providerPaymentId', $provider['paymentId']))
                ->whereIn('refunds.status', ['PROCESSING', 'RECONCILIATION_REQUIRED'])
                ->limit(2)->select('refunds.id')->get();
            if ($candidates->count() !== 1) {
                throw new \RuntimeException('Provider refund cannot be matched unambiguously to a CampusGig refund request');
            }
            $refund = DB::table('PaymentRefund')->where('id', $candidates->first()->id)->first();
        }

        $this->apply($refund->id, $provider);
    }

    private function apply(string $refundId, array $provider): void
    {
        DB::transaction(function () use ($refundId, $provider): void {
            $refund = DB::table('PaymentRefund')->where('id', $refundId)->first();
            DB::table('Order')->where('id', $refund->orderId)->lockForUpdate()->first();
            $payment = $refund->paymentId ? DB::table('Payment')->where('id', $refund->paymentId)->first() : null;
            $purchase = $refund->revisionPurchaseId
                ? DB::table('OrderRevisionPurchase')->where('id', $refund->revisionPurchaseId)->first() : null;
            $earning = DB::table('ProviderEarning')->where('id', $refund->providerEarningId)->first();
            $expectedPaymentId = $payment?->providerPaymentId ?? $purchase?->providerPaymentId;
            if (! $expectedPaymentId || ! $earning) {
                throw new \RuntimeException('Refund accounting evidence is incomplete');
            }
            if (in_array($refund->status, ['SUCCEEDED', 'FAILED'], true)) {
                if ($refund->providerRefundId !== $provider['id']
                    || $provider['paymentId'] !== $expectedPaymentId
                    || $provider['amountCentavos'] !== (int) $refund->refundTotalCentavos
                    || $provider['currency'] !== $refund->currency) {
                    throw new \RuntimeException('Terminal refund evidence does not match the provider update');
                }

                return;
            }
            if ($provider['paymentId'] !== $expectedPaymentId
                || $provider['amountCentavos'] !== (int) $refund->refundTotalCentavos
                || $provider['currency'] !== $refund->currency) {
                DB::table('PaymentRefund')->where('id', $refundId)->update([
                    'providerRefundId' => $provider['id'], 'providerStatus' => $provider['status'],
                    'status' => 'RECONCILIATION_REQUIRED', 'reconciliationRequiredAt' => now(),
                    'failureCode' => 'provider_refund_mismatch', 'updatedAt' => now(),
                ]);

                return;
            }
            $status = match ($provider['status']) {
                'pending' => 'PENDING', 'processing' => 'PROCESSING',
                'succeeded' => 'SUCCEEDED', default => 'FAILED',
            };
            if ($status === 'SUCCEEDED') {
                DB::table('ProviderEarningLedgerEntry')->insert([
                    'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id,
                    'providerId' => $earning->providerId, 'orderId' => $refund->orderId,
                    'type' => 'EARNING_REFUND_REVERSAL',
                    'amountCentavos' => -((int) $refund->providerPrincipalCentavos), 'currency' => $refund->currency,
                    'sourceKey' => "earning:{$earning->id}:refund:{$refund->id}:reversal", 'createdAt' => now(),
                ]);
                DB::table('ProviderEarning')->where('id', $earning->id)->update(['status' => 'REFUNDED', 'updatedAt' => now()]);
                DB::table('PlatformFeeLedgerEntry')->insert([
                    'id' => (string) Str::uuid(), 'orderId' => $refund->orderId, 'refundId' => $refund->id,
                    'type' => 'REFUND_REVERSAL', 'amountCentavos' => -((int) $refund->platformFeeCentavos),
                    'currency' => $refund->currency, 'sourceKey' => "platform-fee:refund:{$refund->id}:reversal", 'createdAt' => now(),
                ]);
                if ($payment) {
                    DB::table('Payment')->where('id', $payment->id)->update([
                        'status' => 'REFUNDED', 'refundedCentavos' => $refund->refundTotalCentavos, 'updatedAt' => now(),
                    ]);
                } else {
                    DB::table('OrderRevisionPurchase')->where('id', $purchase->id)->update([
                        'paymentStatus' => 'REFUNDED', 'activationStatus' => 'REFUNDED',
                        'refundedCentavos' => $refund->refundTotalCentavos, 'updatedAt' => now(),
                    ]);
                }
                $order = DB::table('Order')->where('id', $refund->orderId)->first();
                $this->notify($order->clientId, $refund->orderId, 'ORDER_REFUNDED', 'Refund completed',
                    "Your full refund for {$order->titleSnapshot} has been completed.");
                $this->notify($order->providerId, $refund->orderId, 'ORDER_REFUNDED', 'Refund completed',
                    "The full refund for {$order->titleSnapshot} has been completed.");
            } elseif ($status === 'FAILED') {
                if ($payment) {
                    DB::table('Payment')->where('id', $payment->id)->update(['status' => 'PAID', 'updatedAt' => now()]);
                } else {
                    DB::table('OrderRevisionPurchase')->where('id', $purchase->id)
                        ->update(['paymentStatus' => 'PAID', 'updatedAt' => now()]);
                }
                if ($refund->preRefundEarningStatus !== 'FROZEN') {
                    DB::table('ProviderEarning')->where('id', $earning->id)->update([
                        'status' => $refund->preRefundEarningStatus, 'updatedAt' => now(),
                    ]);
                    $this->recordUnfrozenEntry($refund, $earning);
                }
            }
            DB::table('PaymentRefund')->where('id', $refundId)->update([
                'providerRefundId' => $provider['id'], 'providerStatus' => $provider['status'], 'status' => $status,
                'submittedAt' => $refund->submittedAt ?? now(), 'processedAt' => $status === 'SUCCEEDED' ? now() : null,
                'accountingReversedAt' => $status === 'SUCCEEDED' ? now() : null,
                'providerPrincipalReversedCentavos' => $status === 'SUCCEEDED' ? $refund->providerPrincipalCentavos : 0,
                'platformFeeReversedCentavos' => $status === 'SUCCEEDED' ? $refund->platformFeeCentavos : 0,
                'providerCreatedAt' => $provider['createdAt'], 'providerUpdatedAt' => $provider['updatedAt'],
                'failureCode' => $status === 'FAILED' ? 'provider_failed' : null, 'updatedAt' => now(),
            ]);
        });
    }

    private function submissionFailure(string $refundId, string $status, string $failure): void
    {
        DB::transaction(function () use ($refundId, $status, $failure): void {
            $refund = DB::table('PaymentRefund')->where('id', $refundId)->first();
            DB::table('PaymentRefund')->where('id', $refundId)->update([
                'status' => $status, 'failureCode' => mb_substr($failure, 0, 500),
                'reconciliationRequiredAt' => $status === 'RECONCILIATION_REQUIRED' ? now() : null, 'updatedAt' => now(),
            ]);
            if ($status === 'FAILED') {
                if ($refund->paymentId) {
                    DB::table('Payment')->where('id', $refund->paymentId)->update(['status' => 'PAID', 'updatedAt' => now()]);
                } else {
                    DB::table('OrderRevisionPurchase')->where('id', $refund->revisionPurchaseId)
                        ->update(['paymentStatus' => 'PAID', 'updatedAt' => now()]);
                }
                if ($refund->preRefundEarningStatus !== 'FROZEN') {
                    DB::table('ProviderEarning')->where('id', $refund->providerEarningId)->update([
                        'status' => $refund->preRefundEarningStatus, 'updatedAt' => now(),
                    ]);
                    $earning = DB::table('ProviderEarning')->where('id', $refund->providerEarningId)->first();
                    $this->recordUnfrozenEntry($refund, $earning);
                }
            }
        });
    }

    private function recordUnfrozenEntry(object $refund, object $earning): void
    {
        DB::table('ProviderEarningLedgerEntry')->insertOrIgnore([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id,
            'providerId' => $earning->providerId, 'orderId' => $refund->orderId,
            'type' => 'EARNING_UNFROZEN', 'amountCentavos' => 0, 'currency' => $refund->currency,
            'sourceKey' => "earning:{$earning->id}:refund:{$refund->id}:unfrozen", 'createdAt' => now(),
        ]);
    }

    private function adminRefund(object $refund): array
    {
        $order = $refund->orderId ? DB::table('Order')->where('id', $refund->orderId)->first() : null;

        return [
            ...self::publicRefund($refund),
            'order' => $order ? ['orderNumber' => $order->orderNumber, 'titleSnapshot' => $order->titleSnapshot] : null,
        ];
    }

    public static function publicRefund(object $refund): array
    {
        return [
            'id' => $refund->id, 'orderId' => $refund->orderId, 'paymentId' => $refund->paymentId,
            'revisionPurchaseId' => $refund->revisionPurchaseId,
            'triggeringDisputeId' => $refund->triggeringDisputeId,
            'sourceType' => $refund->sourceType, 'reasonCode' => $refund->reasonCode,
            'requestOrigin' => $refund->requestOrigin, 'providerRefundId' => $refund->providerRefundId,
            'providerPrincipalCentavos' => $refund->providerPrincipalCentavos === null ? null : (int) $refund->providerPrincipalCentavos,
            'platformFeeCentavos' => $refund->platformFeeCentavos === null ? null : (int) $refund->platformFeeCentavos,
            'refundTotalCentavos' => $refund->refundTotalCentavos === null ? null : (int) $refund->refundTotalCentavos,
            'amountCentavos' => (int) $refund->amountCentavos, 'currency' => $refund->currency,
            'reason' => $refund->reason, 'status' => $refund->status,
            'providerStatus' => $refund->providerStatus, 'failureCode' => $refund->failureCode,
            'requestedAt' => CarbonImmutable::parse($refund->requestedAt)->toISOString(),
            'submittedAt' => $refund->submittedAt ? CarbonImmutable::parse($refund->submittedAt)->toISOString() : null,
            'processedAt' => $refund->processedAt ? CarbonImmutable::parse($refund->processedAt)->toISOString() : null,
            'reconciliationRequiredAt' => $refund->reconciliationRequiredAt ? CarbonImmutable::parse($refund->reconciliationRequiredAt)->toISOString() : null,
            'accountingReversedAt' => $refund->accountingReversedAt ? CarbonImmutable::parse($refund->accountingReversedAt)->toISOString() : null,
            'providerPrincipalReversedCentavos' => (int) $refund->providerPrincipalReversedCentavos,
            'platformFeeReversedCentavos' => (int) $refund->platformFeeReversedCentavos,
            'createdAt' => CarbonImmutable::parse($refund->createdAt)->toISOString(),
            'updatedAt' => CarbonImmutable::parse($refund->updatedAt)->toISOString(),
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

    private function notify(string $recipientId, string $orderId, string $type, string $title, string $body): void
    {
        DB::table('Notification')->insert([
            'id' => (string) Str::uuid(), 'recipientId' => $recipientId, 'orderId' => $orderId,
            'type' => $type, 'title' => $title, 'body' => $body, 'createdAt' => now(),
        ]);
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
