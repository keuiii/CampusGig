<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

class ProviderPayoutService
{
    private const REVIEWED_DESTINATIONS = ['ADMIN_REVIEWED', 'PROVIDER_VERIFIED'];

    public function __construct(
        private readonly ProviderEarningsService $earnings,
        private readonly PayoutDestinationCipher $destinationCipher,
    ) {}

    public function createDestination(string $providerId, array $input): array
    {
        $identifier = preg_replace('/[^A-Za-z0-9]/', '', $input['accountIdentifier']) ?? '';
        if (strlen($identifier) < 4) {
            throw $this->badRequest('The destination identifier must contain at least four letters or digits');
        }
        $id = (string) Str::uuid();
        $now = now();
        DB::table('ProviderPayoutDestination')->insert([
            'id' => $id, 'providerId' => $providerId, 'type' => $input['type'],
            'displayLabel' => trim($input['displayLabel']),
            'maskedAccountIdentifier' => '•••• '.substr($identifier, -4),
            'accountHolderName' => trim($input['accountHolderName']),
            'externalReferenceToken' => $this->destinationCipher->encrypt($identifier),
            'verificationStatus' => 'UNVERIFIED', 'isActive' => true,
            'createdAt' => $now, 'updatedAt' => $now,
        ]);

        return ['data' => $this->destination($id)];
    }

    public function destinations(string $providerId): array
    {
        return ['data' => DB::table('ProviderPayoutDestination')->where('providerId', $providerId)
            ->orderByDesc('isActive')->orderByDesc('createdAt')->get()->map(fn (object $row): array => $this->destinationResponse($row))->all()];
    }

    public function deactivateDestination(string $providerId, string $destinationId): array
    {
        $changed = DB::table('ProviderPayoutDestination')->where('id', $destinationId)
            ->where('providerId', $providerId)->where('isActive', true)->update(['isActive' => false, 'updatedAt' => now()]);
        if ($changed !== 1) {
            throw $this->notFound('Active destination not found');
        }

        return ['data' => $this->destination($destinationId)];
    }

    public function request(string $providerId, array $input): array
    {
        $currency = strtoupper(trim($input['currency']));
        $payoutId = DB::transaction(function () use ($providerId, $input, $currency): string {
            DB::table('User')->where('id', $providerId)->lockForUpdate()->first();
            $existing = DB::table('ProviderPayout')->where('providerId', $providerId)
                ->where('clientRequestId', $input['clientRequestId'])->first();
            if ($existing) {
                return $existing->id;
            }
            $destination = DB::table('ProviderPayoutDestination')->where('id', $input['destinationId'])
                ->where('providerId', $providerId)->where('isActive', true)
                ->whereNotNull('externalReferenceToken')
                ->whereIn('verificationStatus', self::REVIEWED_DESTINATIONS)->first();
            if (! $destination) {
                throw $this->conflict('Choose an active destination that an administrator has reviewed');
            }
            $now = CarbonImmutable::now();
            $candidates = DB::table('ProviderEarning')->where('providerId', $providerId)->where('currency', $currency)
                ->where('status', 'AVAILABLE')->where('availableAt', '<=', $now->subDay())
                ->orderBy('availableAt')->orderBy('id')->lockForUpdate()->get();
            $withdrawable = $candidates->filter(fn (object $earning): bool => $this->earnings->isWithdrawable($earning, $now, $currency))->values();
            if ($withdrawable->isEmpty()) {
                throw $this->conflict('No earnings in this currency are currently withdrawable');
            }
            $principal = (int) $withdrawable->sum('grossServiceAmountCentavos');
            if ($principal <= 0) {
                throw $this->conflict('Withdrawable principal is invalid');
            }
            $id = (string) Str::uuid();
            $snapshot = [
                'type' => $destination->type, 'displayLabel' => $destination->displayLabel,
                'maskedAccountIdentifier' => $destination->maskedAccountIdentifier,
                'accountHolderName' => $destination->accountHolderName,
                'verificationStatus' => $destination->verificationStatus,
            ];
            DB::table('ProviderPayout')->insert([
                'id' => $id, 'providerId' => $providerId, 'destinationId' => $destination->id,
                'clientRequestId' => $input['clientRequestId'],
                'sourceKey' => "provider:{$providerId}:payout-request:{$input['clientRequestId']}",
                'currency' => $currency, 'requestedPrincipalCentavos' => $principal,
                'eligiblePrincipalCentavos' => $principal, 'payoutFeeCentavos' => 0,
                'netDisbursementCentavos' => $principal, 'status' => 'REQUESTED',
                'destinationSnapshot' => json_encode($snapshot, JSON_THROW_ON_ERROR),
                'requestedAt' => $now, 'createdAt' => $now, 'updatedAt' => $now,
            ]);
            foreach ($withdrawable as $earning) {
                $changed = DB::table('ProviderEarning')->where('id', $earning->id)->where('status', 'AVAILABLE')
                    ->update(['status' => 'PAYOUT_PROCESSING', 'updatedAt' => $now]);
                if ($changed !== 1) {
                    throw $this->conflict('An earning changed before payout reservation completed');
                }
                DB::table('ProviderPayoutItem')->insert([
                    'id' => (string) Str::uuid(), 'payoutId' => $id, 'providerEarningId' => $earning->id,
                    'principalCentavos' => $earning->grossServiceAmountCentavos, 'currency' => $currency,
                    'reservationActive' => true, 'createdAt' => $now,
                ]);
                $this->ledger($earning, $id, 'EARNING_PAYOUT_RESERVED', 'reserved', $now);
            }
            $this->audit($id, $providerId, 'REQUESTED', [
                'earningCount' => $withdrawable->count(), 'principalCentavos' => $principal,
                'payoutFeeCentavos' => 0, 'netDisbursementCentavos' => $principal,
            ], $now);
            $this->notify($providerId, 'PROVIDER_PAYOUT_REQUESTED', 'Payout requested',
                "Your {$currency} payout request is under administrator review. No money has been sent yet.", $now);

            return $id;
        });

        return ['data' => $this->providerDetail($providerId, $payoutId)];
    }

    public function providerList(string $providerId, int $limit = 25): array
    {
        return ['data' => DB::table('ProviderPayout')->where('providerId', $providerId)
            ->orderByDesc('requestedAt')->orderByDesc('id')->limit($limit)->get()
            ->map(fn (object $row): array => $this->payoutResponse($row))->all()];
    }

    public function cancel(string $providerId, string $payoutId): array
    {
        $this->releaseReservation($payoutId, $providerId, 'REQUESTED', 'CANCELLED', 'Provider cancelled the payout before approval', $providerId);

        return ['data' => $this->providerDetail($providerId, $payoutId)];
    }

    public function adminList(int $limit): array
    {
        return ['data' => DB::table('ProviderPayout')->orderByDesc('requestedAt')->orderByDesc('id')->limit($limit)->get()
            ->map(fn (object $row): array => $this->adminPayoutResponse($row))->all()];
    }

    public function adminDestinations(): array
    {
        return ['data' => DB::table('ProviderPayoutDestination as destination')
            ->join('User as provider', 'provider.id', '=', 'destination.providerId')
            ->orderBy('destination.verificationStatus')->orderBy('destination.createdAt')->limit(100)
            ->get(['destination.*', 'provider.id as userId', 'provider.displayName', 'provider.email'])
            ->map(function (object $row): array {
                $data = $this->destinationResponse($row);
                $data['provider'] = ['id' => $row->userId, 'displayName' => $row->displayName, 'email' => $row->email];

                return $data;
            })->all()];
    }

    public function reviewDestination(string $adminId, string $destinationId, string $note): array
    {
        $destination = DB::table('ProviderPayoutDestination')->where('id', $destinationId)->first();
        if (! $destination) {
            throw $this->notFound('Payout destination not found');
        }
        if (! $destination->externalReferenceToken) {
            throw $this->conflict('Recreate this payout destination before review because secure transfer details are unavailable');
        }
        DB::table('ProviderPayoutDestination')->where('id', $destinationId)->update([
            'verificationStatus' => 'ADMIN_REVIEWED', 'reviewedById' => $adminId,
            'reviewedAt' => now(), 'reviewNote' => trim($note), 'updatedAt' => now(),
        ]);

        return ['data' => $this->destination($destinationId)];
    }

    public function sensitiveDestinationDetails(string $adminId, string $destinationId): array
    {
        $destination = DB::table('ProviderPayoutDestination')->where('id', $destinationId)->first();
        if (! $destination) {
            throw $this->notFound('Payout destination not found');
        }
        if (! $destination->externalReferenceToken) {
            throw $this->conflict('Secure transfer details are unavailable; ask the provider to recreate this destination');
        }
        try {
            $accountIdentifier = $this->destinationCipher->decrypt($destination->externalReferenceToken);
        } catch (Throwable) {
            Log::error('Payout destination decryption failed', [
                'adminId' => $adminId,
                'destinationId' => $destinationId,
            ]);
            throw $this->conflict('Secure transfer details could not be read; do not process this payout');
        }
        Log::warning('Payout destination sensitive details revealed', [
            'adminId' => $adminId,
            'destinationId' => $destinationId,
        ]);

        return ['data' => [
            'id' => $destination->id,
            'type' => $destination->type,
            'displayLabel' => $destination->displayLabel,
            'accountIdentifier' => $accountIdentifier,
            'accountHolderName' => $destination->accountHolderName,
        ]];
    }

    public function approve(string $adminId, string $payoutId, string $note): array
    {
        $this->transition($payoutId, function (object $payout, $items) use ($adminId, $note): void {
            if ($payout->status === 'APPROVED') {
                return;
            }
            if ($payout->status !== 'REQUESTED') {
                throw $this->conflict('Only a requested payout can be approved');
            }
            $destination = DB::table('ProviderPayoutDestination')->where('id', $payout->destinationId)->first();
            if (! $destination?->isActive || ! $destination->externalReferenceToken
                || ! in_array($destination->verificationStatus, self::REVIEWED_DESTINATIONS, true)) {
                throw $this->conflict('The payout destination is no longer eligible');
            }
            try {
                $this->destinationCipher->decrypt($destination->externalReferenceToken);
            } catch (Throwable) {
                throw $this->conflict('Secure transfer details could not be read; do not approve this payout');
            }
            $this->assertReserved($payout, $items);
            $now = now();
            DB::table('ProviderPayout')->where('id', $payout->id)->update([
                'status' => 'APPROVED', 'approvedById' => $adminId, 'approvedAt' => $now, 'updatedAt' => $now,
            ]);
            $this->audit($payout->id, $adminId, 'APPROVED', ['note' => trim($note)], $now);
            $this->notify($payout->providerId, 'PROVIDER_PAYOUT_APPROVED', 'Payout approved',
                'Your payout was approved. It has not been sent yet.', $now);
        });

        return ['data' => $this->adminDetail($payoutId)];
    }

    public function reject(string $adminId, string $payoutId, string $note): array
    {
        $this->releaseReservation($payoutId, $adminId, 'REQUESTED', 'REJECTED', trim($note));

        return ['data' => $this->adminDetail($payoutId)];
    }

    public function beginManual(string $adminId, string $payoutId, string $note): array
    {
        $this->transition($payoutId, function (object $payout, $items) use ($adminId, $note): void {
            if ($payout->status === 'PROCESSING' && $payout->settlementMethod === 'MANUAL') {
                return;
            }
            if ($payout->status !== 'APPROVED') {
                throw $this->conflict('Only an approved payout can begin manual settlement');
            }
            $this->assertReserved($payout, $items);
            $now = now();
            DB::table('ProviderPayout')->where('id', $payout->id)->update([
                'status' => 'PROCESSING', 'settlementMethod' => 'MANUAL', 'processingAt' => $now, 'updatedAt' => $now,
            ]);
            $this->audit($payout->id, $adminId, 'PROCESSING', [
                'method' => 'MANUAL', 'note' => trim($note), 'warning' => 'No automated bank or wallet transfer occurred',
            ], $now);
            $this->notify($payout->providerId, 'PROVIDER_PAYOUT_PROCESSING', 'Manual payout processing',
                'An administrator started manual settlement. This is not confirmation that money was received.', $now);
        });

        return ['data' => $this->adminDetail($payoutId)];
    }

    public function settleManual(string $adminId, string $payoutId, array $input): array
    {
        $settledAt = CarbonImmutable::parse($input['settledAt']);
        if ($settledAt->greaterThan(CarbonImmutable::now()->addMinutes(5))) {
            throw $this->badRequest('Settlement timestamp cannot be in the future');
        }
        $this->transition($payoutId, function (object $payout, $items) use ($adminId, $input, $settledAt): void {
            $reference = trim($input['manualReference']);
            if ($payout->status === 'PAID') {
                if ($payout->manualSettlementReference === $reference && (int) $payout->netDisbursementCentavos === (int) $input['amountCentavos']) {
                    return;
                }
                throw $this->conflict('This payout was already settled differently');
            }
            if ($payout->status !== 'PROCESSING' || $payout->settlementMethod !== 'MANUAL') {
                throw $this->conflict('Begin manual settlement before recording payment evidence');
            }
            if ((int) $input['amountCentavos'] !== (int) $payout->netDisbursementCentavos
                || $settledAt->lessThan(CarbonImmutable::parse($payout->requestedAt))) {
                throw $this->conflict('Settlement evidence does not match the immutable payout');
            }
            $this->assertReserved($payout, $items);
            foreach ($items as $item) {
                $changed = DB::table('ProviderEarning')->where('id', $item->providerEarningId)
                    ->where('status', 'PAYOUT_PROCESSING')->update(['status' => 'PAID_OUT', 'updatedAt' => $settledAt]);
                if ($changed !== 1) {
                    throw $this->conflict('A reserved earning changed before settlement completed');
                }
                $earning = DB::table('ProviderEarning')->where('id', $item->providerEarningId)->first();
                $this->ledger($earning, $payout->id, 'EARNING_PAID_OUT', 'paid-out', $settledAt);
            }
            DB::table('ProviderPayout')->where('id', $payout->id)->update([
                'status' => 'PAID', 'settledById' => $adminId, 'manualSettlementReference' => $reference,
                'settlementNote' => trim($input['note']), 'settlementAt' => $settledAt, 'paidAt' => $settledAt,
                'externalStatus' => 'manual_settlement_confirmed', 'updatedAt' => $settledAt,
            ]);
            $this->audit($payout->id, $adminId, 'MANUAL_SETTLED', [
                'amountCentavos' => (int) $input['amountCentavos'], 'manualReference' => $reference,
                'settlementAt' => $settledAt->toISOString(), 'note' => trim($input['note']),
            ], $settledAt);
            $this->notify($payout->providerId, 'PROVIDER_PAYOUT_PAID', 'Manual payout recorded',
                'An administrator recorded evidence of manual settlement for your payout.', $settledAt);
        });

        return ['data' => $this->adminDetail($payoutId)];
    }

    public function adminDetail(string $payoutId): array
    {
        $row = DB::table('ProviderPayout')->where('id', $payoutId)->first();
        if (! $row) {
            throw $this->notFound('Payout not found');
        }

        return $this->adminPayoutResponse($row);
    }

    private function providerDetail(string $providerId, string $payoutId): array
    {
        $row = DB::table('ProviderPayout')->where('id', $payoutId)->where('providerId', $providerId)->first();
        if (! $row) {
            throw $this->notFound('Payout not found');
        }

        return $this->payoutResponse($row);
    }

    private function transition(string $payoutId, callable $action): void
    {
        DB::transaction(function () use ($payoutId, $action): void {
            $payout = DB::table('ProviderPayout')->where('id', $payoutId)->lockForUpdate()->first();
            if (! $payout) {
                throw $this->notFound('Payout not found');
            }
            DB::table('User')->where('id', $payout->providerId)->lockForUpdate()->first();
            $items = DB::table('ProviderPayoutItem')->where('payoutId', $payoutId)->orderBy('id')->lockForUpdate()->get();
            $action($payout, $items);
        });
    }

    private function assertReserved(object $payout, $items): void
    {
        $total = (int) $items->sum('principalCentavos');
        if ($items->isEmpty() || $total !== (int) $payout->requestedPrincipalCentavos
            || (int) $payout->eligiblePrincipalCentavos !== $total || (int) $payout->payoutFeeCentavos !== 0
            || (int) $payout->netDisbursementCentavos !== $total) {
            throw $this->conflict('Payout reservation does not reconcile');
        }
        foreach ($items as $item) {
            $earning = DB::table('ProviderEarning')->where('id', $item->providerEarningId)->first();
            if (! $item->reservationActive || $item->currency !== $payout->currency || ! $earning
                || $earning->providerId !== $payout->providerId || $earning->status !== 'PAYOUT_PROCESSING'
                || (int) $earning->grossServiceAmountCentavos !== (int) $item->principalCentavos) {
                throw $this->conflict('Payout reservation does not reconcile');
            }
            $this->earnings->assertPrincipal($earning);
        }
    }

    private function releaseReservation(string $payoutId, string $actorId, string $expected, string $final, string $note, ?string $providerId = null): void
    {
        $this->transition($payoutId, function (object $payout, $items) use ($actorId, $expected, $final, $note, $providerId): void {
            if ($providerId !== null && $payout->providerId !== $providerId) {
                throw $this->notFound('Payout not found');
            }
            if ($payout->status === $final) {
                return;
            }
            if ($payout->status !== $expected) {
                throw $this->conflict('This payout can no longer release its reservation');
            }
            $this->assertReserved($payout, $items);
            $now = now();
            foreach ($items as $item) {
                DB::table('ProviderEarning')->where('id', $item->providerEarningId)
                    ->update(['status' => 'AVAILABLE', 'updatedAt' => $now]);
                DB::table('ProviderPayoutItem')->where('id', $item->id)->update(['reservationActive' => false]);
                $earning = DB::table('ProviderEarning')->where('id', $item->providerEarningId)->first();
                $this->ledger($earning, $payout->id, 'EARNING_PAYOUT_RELEASED', 'released', $now);
            }
            $timestamp = $final === 'CANCELLED' ? 'cancelledAt' : 'rejectedAt';
            DB::table('ProviderPayout')->where('id', $payout->id)->update([
                'status' => $final, $timestamp => $now, 'updatedAt' => $now,
            ]);
            $this->audit($payout->id, $actorId, $final, ['note' => $note], $now);
            $this->notify($payout->providerId, "PROVIDER_PAYOUT_{$final}", $final === 'CANCELLED' ? 'Payout cancelled' : 'Payout rejected',
                "{$note}. Reserved earnings are available again with their original eligibility timestamps.", $now);
        });
    }

    private function payoutResponse(object $row): array
    {
        $data = [
            'id' => $row->id, 'providerId' => $row->providerId, 'destinationId' => $row->destinationId,
            'currency' => $row->currency, 'requestedPrincipalCentavos' => (int) $row->requestedPrincipalCentavos,
            'payoutFeeCentavos' => (int) $row->payoutFeeCentavos, 'netDisbursementCentavos' => (int) $row->netDisbursementCentavos,
            'status' => $row->status, 'destinationSnapshot' => $this->json($row->destinationSnapshot),
            'settlementMethod' => $row->settlementMethod, 'externalStatus' => $row->externalStatus,
            'failureCode' => $row->failureCode,
        ];
        foreach (['requestedAt', 'approvedAt', 'processingAt', 'paidAt', 'failedAt', 'rejectedAt', 'cancelledAt', 'reconciliationRequiredAt'] as $field) {
            $data[$field] = $this->date($row->{$field});
        }
        $data['items'] = DB::table('ProviderPayoutItem')->where('payoutId', $row->id)->get()->map(fn (object $item): array => [
            'id' => $item->id, 'providerEarningId' => $item->providerEarningId,
            'principalCentavos' => (int) $item->principalCentavos, 'currency' => $item->currency,
            'reservationActive' => (bool) $item->reservationActive,
        ])->all();

        return $data;
    }

    private function adminPayoutResponse(object $row): array
    {
        $data = $this->payoutResponse($row);
        $data['manualSettlementReference'] = $row->manualSettlementReference;
        $data['settlementNote'] = $row->settlementNote;
        $data['settlementAt'] = $this->date($row->settlementAt);
        $provider = DB::table('User')->where('id', $row->providerId)->first(['id', 'displayName', 'email']);
        $data['provider'] = (array) $provider;
        $data['destination'] = $this->destination($row->destinationId);
        $data['audits'] = DB::table('ProviderPayoutAudit as audit')->leftJoin('User as actor', 'actor.id', '=', 'audit.actorId')
            ->where('audit.payoutId', $row->id)->orderBy('audit.createdAt')->orderBy('audit.id')
            ->get(['audit.*', 'actor.displayName'])->map(fn (object $audit): array => [
                'id' => $audit->id, 'action' => $audit->action, 'context' => $this->json($audit->context),
                'createdAt' => $this->date($audit->createdAt),
                'actor' => $audit->actorId ? ['id' => $audit->actorId, 'displayName' => $audit->displayName] : null,
            ])->all();

        return $data;
    }

    private function destination(string $id): array
    {
        $row = DB::table('ProviderPayoutDestination')->where('id', $id)->first();
        if (! $row) {
            throw $this->notFound('Payout destination not found');
        }

        return $this->destinationResponse($row);
    }

    private function destinationResponse(object $row): array
    {
        return [
            'id' => $row->id, 'type' => $row->type, 'displayLabel' => $row->displayLabel,
            'maskedAccountIdentifier' => $row->maskedAccountIdentifier, 'accountHolderName' => $row->accountHolderName,
            'verificationStatus' => $row->verificationStatus, 'reviewedAt' => $this->date($row->reviewedAt),
            'isActive' => (bool) $row->isActive, 'createdAt' => $this->date($row->createdAt),
            'updatedAt' => $this->date($row->updatedAt),
        ];
    }

    private function ledger(object $earning, string $payoutId, string $type, string $suffix, mixed $at): void
    {
        DB::table('ProviderEarningLedgerEntry')->insert([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id, 'providerId' => $earning->providerId,
            'orderId' => $earning->orderId, 'type' => $type, 'amountCentavos' => 0,
            'currency' => $earning->currency, 'sourceKey' => "earning:{$earning->id}:payout:{$payoutId}:{$suffix}",
            'createdAt' => $at,
        ]);
    }

    private function audit(string $payoutId, ?string $actorId, string $action, array $context, mixed $at): void
    {
        DB::table('ProviderPayoutAudit')->insert([
            'id' => (string) Str::uuid(), 'payoutId' => $payoutId, 'actorId' => $actorId, 'action' => $action,
            'context' => json_encode($context, JSON_THROW_ON_ERROR), 'createdAt' => $at,
        ]);
    }

    private function notify(string $recipientId, string $type, string $title, string $body, mixed $at): void
    {
        DB::table('Notification')->insert([
            'id' => (string) Str::uuid(), 'recipientId' => $recipientId, 'type' => $type,
            'title' => $title, 'body' => $body, 'createdAt' => $at,
        ]);
    }

    private function date(mixed $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->toISOString() : null;
    }

    private function json(mixed $value): mixed
    {
        if (! is_string($value)) {
            return $value;
        }
        $decoded = json_decode($value, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $value;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return $this->httpError(400, 'Bad Request', $message);
    }

    private function notFound(string $message): HttpResponseException
    {
        return $this->httpError(404, 'Not Found', $message);
    }

    private function conflict(string $message): HttpResponseException
    {
        return $this->httpError(409, 'Conflict', $message);
    }

    private function httpError(int $status, string $error, string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $error, 'statusCode' => $status], $status));
    }
}
