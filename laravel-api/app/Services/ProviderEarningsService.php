<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Throwable;

class ProviderEarningsService
{
    private const STATUSES = ['PENDING', 'AVAILABLE', 'FROZEN', 'PAYOUT_PROCESSING', 'PAID_OUT', 'REFUNDED'];

    private const ACTIVE_DISPUTES = ['OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW'];

    private const ACTIVE_REFUNDS = ['REQUESTED', 'PENDING', 'PROCESSING', 'RECONCILIATION_REQUIRED'];

    public function __construct(private readonly OrderService $orders) {}

    public function summary(string $providerId): array
    {
        $this->orders->reconcileExpiredReviewsForProvider($providerId);
        $rows = DB::table('ProviderEarning as earning')
            ->join('ProviderEarningLedgerEntry as credit', function ($join): void {
                $join->on('credit.providerEarningId', '=', 'earning.id')->where('credit.type', 'EARNING_PENDING_CREDIT');
            })
            ->where('earning.providerId', $providerId)->whereIn('earning.status', self::STATUSES)
            ->groupBy('earning.currency', 'earning.status')
            ->selectRaw('earning.currency, earning.status, SUM(credit.amountCentavos) as amount')->get();
        $currencies = $rows->pluck('currency')->unique()->sort()->values();
        $available = DB::table('ProviderEarning')->where('providerId', $providerId)->where('status', 'AVAILABLE')->get();
        $now = CarbonImmutable::now();

        return ['data' => $currencies->map(function (string $currency) use ($rows, $available, $now): array {
            $amount = fn (string $status): int => (int) ($rows->first(fn (object $row): bool => $row->currency === $currency && $row->status === $status)?->amount ?? 0);
            $withdrawable = $available->where('currency', $currency)->sum(
                fn (object $earning): int => $this->isWithdrawable($earning, $now) ? (int) $earning->grossServiceAmountCentavos : 0
            );

            return [
                'currency' => $currency,
                'pendingCentavos' => $amount('PENDING'),
                'availableCentavos' => $amount('AVAILABLE'),
                'withdrawableCentavos' => $withdrawable,
                'frozenCentavos' => $amount('FROZEN'),
                'payoutProcessingCentavos' => $amount('PAYOUT_PROCESSING'),
                'paidOutCentavos' => $amount('PAID_OUT'),
                'refundedCentavos' => $amount('REFUNDED'),
            ];
        })->all()];
    }

    public function list(string $providerId, ?string $cursor, int $limit): array
    {
        $this->orders->reconcileExpiredReviewsForProvider($providerId);
        $query = DB::table('ProviderEarning as earning')->join('Order as order', 'order.id', '=', 'earning.orderId')
            ->leftJoin('OrderRevisionPurchase as purchase', 'purchase.id', '=', 'earning.revisionPurchaseId')
            ->leftJoin('RevisionRequest as revision', 'revision.id', '=', 'purchase.revisionRequestId')
            ->where('earning.providerId', $providerId);
        if ($cursor) {
            [$pendingAt, $id] = $this->decodeCursor($cursor);
            $query->where(fn ($nested) => $nested->where('earning.pendingAt', '<', $pendingAt)
                ->orWhere(fn ($same) => $same->where('earning.pendingAt', $pendingAt)->where('earning.id', '<', $id)));
        }
        $rows = $query->orderByDesc('earning.pendingAt')->orderByDesc('earning.id')->limit($limit + 1)->get([
            'earning.*', 'order.orderNumber', 'order.titleSnapshot as serviceTitle',
            'revision.sequenceNumber as revisionSequence',
        ]);
        $hasMore = $rows->count() > $limit;
        $page = $hasMore ? $rows->take($limit) : $rows;
        $data = $page->map(fn (object $earning): array => $this->earningResponse($earning))->values()->all();
        $last = $page->last();

        return ['data' => $data, 'pagination' => [
            'hasMore' => $hasMore,
            'nextCursor' => $hasMore && $last ? $this->encodeCursor($last->pendingAt, $last->id) : null,
        ]];
    }

    public function isWithdrawable(object $earning, CarbonImmutable $now, ?string $currency = null): bool
    {
        if ($earning->status !== 'AVAILABLE' || ! $earning->availableAt
            || CarbonImmutable::parse($earning->availableAt)->addDay()->greaterThan($now)
            || ($currency !== null && $earning->currency !== $currency)) {
            return false;
        }
        if (DB::table('DisputeAffectedEarning as affected')->join('OrderDispute as dispute', 'dispute.id', '=', 'affected.disputeId')
            ->where('affected.providerEarningId', $earning->id)->whereIn('dispute.status', self::ACTIVE_DISPUTES)->exists()
            || DB::table('PaymentRefund')->where('providerEarningId', $earning->id)->whereIn('status', self::ACTIVE_REFUNDS)->exists()
            || DB::table('ProviderPayoutItem')->where('providerEarningId', $earning->id)->where('reservationActive', true)->exists()) {
            return false;
        }
        $this->assertPrincipal($earning);

        return true;
    }

    public function assertPrincipal(object $earning): void
    {
        $entries = DB::table('ProviderEarningLedgerEntry')->where('providerEarningId', $earning->id)->get();
        $credits = $entries->where('type', 'EARNING_PENDING_CREDIT');
        $reversals = $entries->where('type', 'EARNING_REFUND_REVERSAL');
        if ($credits->count() !== 1 || (int) $credits->first()->amountCentavos !== (int) $earning->grossServiceAmountCentavos
            || $credits->first()->currency !== $earning->currency || $reversals->isNotEmpty()
            || (int) $credits->sum('amountCentavos') !== (int) $earning->grossServiceAmountCentavos) {
            throw new \RuntimeException('Provider earning principal does not reconcile');
        }
    }

    private function earningResponse(object $earning): array
    {
        $entries = DB::table('ProviderEarningLedgerEntry')->where('providerEarningId', $earning->id)
            ->orderBy('createdAt')->orderBy('id')->get();
        $credits = $entries->where('type', 'EARNING_PENDING_CREDIT');
        $available = $entries->where('type', 'EARNING_AVAILABLE_RELEASE');
        $refunds = $entries->where('type', 'EARNING_REFUND_REVERSAL');
        $reserved = $entries->where('type', 'EARNING_PAYOUT_RESERVED');
        $released = $entries->where('type', 'EARNING_PAYOUT_RELEASED');
        $paid = $entries->where('type', 'EARNING_PAID_OUT');
        if ($credits->count() !== 1 || (int) $credits->sum('amountCentavos') !== (int) $earning->grossServiceAmountCentavos
            || $credits->contains(fn (object $entry): bool => $entry->providerId !== $earning->providerId
                || $entry->orderId !== $earning->orderId || $entry->currency !== $earning->currency)
            || ($earning->status === 'PENDING' && ($earning->availableAt || $available->isNotEmpty()))
            || ($earning->status === 'AVAILABLE' && (! $earning->availableAt || $available->count() !== 1 || (int) $available->first()->amountCentavos !== 0))
            || ($earning->status === 'REFUNDED' && ($refunds->count() !== 1 || (int) $refunds->first()->amountCentavos !== -(int) $earning->grossServiceAmountCentavos))
            || ($earning->status !== 'REFUNDED' && $refunds->isNotEmpty())
            || ($earning->status === 'PAYOUT_PROCESSING' && ($reserved->count() !== $released->count() + 1 || $paid->isNotEmpty()))
            || ($earning->status === 'PAID_OUT' && ($reserved->count() !== $released->count() + 1 || $paid->count() !== 1))
            || (in_array($earning->status, ['PENDING', 'AVAILABLE', 'FROZEN', 'REFUNDED'], true) && $reserved->count() !== $released->count())) {
            throw new \RuntimeException('Provider earnings accounting is inconsistent');
        }
        $eligibleAt = $earning->availableAt ? CarbonImmutable::parse($earning->availableAt)->addDay() : null;

        return [
            'id' => $earning->id, 'orderId' => $earning->orderId, 'orderNumber' => $earning->orderNumber,
            'serviceTitle' => $earning->serviceTitle, 'sourceType' => $earning->sourceType,
            'revisionSequence' => $earning->revisionSequence === null ? null : (int) $earning->revisionSequence,
            'amountCentavos' => (int) $earning->grossServiceAmountCentavos, 'currency' => $earning->currency,
            'status' => $earning->status, 'pendingAt' => $this->date($earning->pendingAt),
            'availableAt' => $this->date($earning->availableAt), 'withdrawalEligibleAt' => $eligibleAt?->toISOString(),
            'isWithdrawable' => $this->isWithdrawable($earning, CarbonImmutable::now()),
            'createdAt' => $this->date($earning->createdAt),
            'entries' => $entries->map(fn (object $entry): array => [
                'type' => $entry->type, 'amountCentavos' => (int) $entry->amountCentavos,
                'currency' => $entry->currency, 'createdAt' => $this->date($entry->createdAt),
            ])->all(),
        ];
    }

    private function encodeCursor(mixed $pendingAt, string $id): string
    {
        return rtrim(strtr(base64_encode(json_encode(['pendingAt' => $this->date($pendingAt), 'id' => $id], JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    }

    private function decodeCursor(string $cursor): array
    {
        $decoded = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = $decoded === false ? null : json_decode($decoded, true);
        try {
            if (! is_array($value) || ! is_string($value['pendingAt'] ?? null) || ! is_string($value['id'] ?? null)) {
                throw new \InvalidArgumentException;
            }

            return [CarbonImmutable::parse($value['pendingAt']), $value['id']];
        } catch (Throwable) {
            throw new HttpResponseException(response()->json(['message' => 'Invalid provider earning cursor', 'error' => 'Bad Request', 'statusCode' => 400], 400));
        }
    }

    private function date(mixed $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->toISOString() : null;
    }
}
