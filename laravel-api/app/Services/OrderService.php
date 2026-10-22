<?php

namespace App\Services;

use App\Services\Storage\PrivateMediaStorage;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class OrderService
{
    private const ACTIVE_STATUSES = ['ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'];

    private const ACTIVE_DISPUTE_STATUSES = ['OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW'];

    public function __construct(
        private readonly MarketplacePricingService $pricing,
        private readonly PrivateMediaStorage $storage,
    ) {}

    public function create(string $clientId, array $input): array
    {
        $fingerprint = isset($input['clientRequestId']) ? $this->fingerprint($input) : null;
        if (isset($input['clientRequestId'])) {
            $existing = $this->findByRequestId($clientId, $input['clientRequestId']);
            if ($existing) {
                return $this->idempotentResponse($existing, $fingerprint);
            }
        }

        $service = DB::table('Service as service')
            ->join('User as provider', 'provider.id', '=', 'service.providerId')
            ->join('ProviderProfile as profile', 'profile.userId', '=', 'service.providerId')
            ->where('service.id', $input['serviceId'])->where('service.status', 'PUBLISHED')->whereNull('service.deletedAt')
            ->select([
                'service.*', 'provider.displayName as providerName', 'profile.isAvailable', 'profile.maxPendingOrders',
            ])->first();
        if (! $service) {
            throw $this->notFound('Service is no longer available');
        }
        if (! $service->isAvailable) {
            throw $this->conflict('This provider is currently unavailable for new work');
        }
        if ($service->providerId === $clientId) {
            throw $this->badRequest('You cannot order your own service');
        }

        $terms = $service->pricingModel === 'SINGLE_PRICE_V2'
            ? $this->singlePriceTerms($service, $input)
            : $this->legacyTerms($service, $input);
        $orderId = (string) Str::uuid();
        $orderNumber = 'CG-'.now()->year.'-'.strtoupper(substr(str_replace('-', '', (string) Str::uuid()), 0, 8));
        $now = now();

        try {
            $created = DB::transaction(function () use ($clientId, $input, $fingerprint, $service, $terms, $orderId, $orderNumber, $now): object {
                DB::table('ProviderProfile')->where('userId', $service->providerId)->lockForUpdate()->first();
                if (isset($input['clientRequestId'])) {
                    $existing = $this->findByRequestId($clientId, $input['clientRequestId']);
                    if ($existing) {
                        return $existing;
                    }
                }
                $profile = DB::table('ProviderProfile')->where('userId', $service->providerId)->first();
                if (! $profile?->isAvailable) {
                    throw $this->conflict('This provider is currently unavailable for new work');
                }
                $pending = DB::table('Order')->where('providerId', $service->providerId)->where('status', 'REQUESTED')->count();
                if ($pending >= (int) $profile->maxPendingOrders) {
                    throw $this->conflict("This provider's request queue is currently full. Please try again later.");
                }

                DB::table('Order')->insert([
                    'id' => $orderId,
                    'orderNumber' => $orderNumber,
                    'clientRequestId' => $input['clientRequestId'] ?? null,
                    'requestFingerprint' => $fingerprint,
                    'clientId' => $clientId,
                    'providerId' => $service->providerId,
                    'serviceId' => $service->id,
                    'servicePackageId' => $terms['servicePackageId'],
                    'pricingModel' => $terms['pricingModel'],
                    'titleSnapshot' => $service->title,
                    'packageSnapshot' => $terms['packageSnapshot'] === null ? null : json_encode($terms['packageSnapshot'], JSON_THROW_ON_ERROR),
                    'termsSnapshot' => json_encode($terms['termsSnapshot'], JSON_THROW_ON_ERROR),
                    'basePriceCentavos' => $terms['basePriceCentavos'],
                    'rushSurchargeCentavos' => $terms['rushSurchargeCentavos'],
                    'deliveryOption' => $terms['deliveryOption'],
                    'deliveryDurationMinutes' => $terms['deliveryDurationMinutes'],
                    'pricingPolicyVersion' => $terms['pricingPolicyVersion'],
                    'platformFeeBasisPoints' => $terms['platformFeeBasisPoints'],
                    'rushBasisPoints' => $terms['rushBasisPoints'],
                    'subtotalCentavos' => $terms['subtotalCentavos'],
                    'platformFeeCentavos' => $terms['platformFeeCentavos'],
                    'totalCentavos' => $terms['totalCentavos'],
                    'currency' => 'PHP',
                    'requirements' => trim($input['requirements']),
                    'dueAt' => $terms['dueAt'],
                    'status' => 'REQUESTED',
                    'revisionLimit' => $terms['revisionLimit'],
                    'revisionsUsed' => 0,
                    'createdAt' => $now,
                    'updatedAt' => $now,
                ]);
                $this->history($orderId, null, 'REQUESTED', $clientId, $terms['historyNote']);
                $conversationId = (string) Str::uuid();
                DB::table('Conversation')->insert([
                    'id' => $conversationId, 'kind' => 'ORDER', 'orderId' => $orderId, 'createdAt' => $now,
                ]);
                DB::table('ConversationParticipant')->insert([
                    ['conversationId' => $conversationId, 'userId' => $clientId],
                    ['conversationId' => $conversationId, 'userId' => $service->providerId],
                ]);
                $this->notification(
                    $service->providerId,
                    $orderId,
                    'NEW_ORDER',
                    'New service request',
                    "A client requested {$service->title}. {$terms['notificationSuffix']}",
                );

                return DB::table('Order')->where('id', $orderId)->first();
            });
        } catch (QueryException $error) {
            if (! isset($input['clientRequestId']) || ! $this->isUniqueViolation($error)) {
                throw $error;
            }
            $existing = $this->findByRequestId($clientId, $input['clientRequestId']);
            if (! $existing) {
                throw $error;
            }

            return $this->idempotentResponse($existing, $fingerprint);
        }

        if ($created->id !== $orderId) {
            return $this->idempotentResponse($created, $fingerprint);
        }

        return [
            'data' => $this->response($created),
            'message' => "{$service->providerName} has been notified.",
        ];
    }

    public function list(string $userId, string $scope, string $view, ?string $cursor, int $limit): array
    {
        $query = DB::table('Order');
        $participantColumn = $scope === 'provider' ? 'providerId' : 'clientId';
        $archivedColumn = $scope === 'provider' ? 'providerArchivedAt' : 'clientArchivedAt';
        $removedColumn = $scope === 'provider' ? 'providerRemovedAt' : 'clientRemovedAt';
        $query->where($participantColumn, $userId)->whereNull($removedColumn);
        $view === 'archived' ? $query->whereNotNull($archivedColumn) : $query->whereNull($archivedColumn);
        if ($cursor) {
            [$createdAt, $id] = $this->decodeCursor($cursor);
            $query->where(function ($where) use ($createdAt, $id): void {
                $where->where('createdAt', '<', $createdAt)
                    ->orWhere(fn ($tie) => $tie->where('createdAt', $createdAt)->where('id', '<', $id));
            });
        }
        $orders = $query->orderByDesc('createdAt')->orderByDesc('id')->limit($limit + 1)->get();
        $hasMore = $orders->count() > $limit;
        $page = $hasMore ? $orders->take($limit)->values() : $orders;
        $last = $page->last();

        return [
            'data' => $page->map(fn (object $order): array => $this->response($order))->all(),
            'pagination' => [
                'hasMore' => $hasMore,
                'nextCursor' => $hasMore && $last ? $this->encodeCursor($last->createdAt, $last->id) : null,
            ],
        ];
    }

    public function find(string $userId, string $orderId): array
    {
        $order = $this->participantOrder($userId, $orderId);
        $history = DB::table('OrderStatusHistory as history')
            ->leftJoin('User as actor', 'actor.id', '=', 'history.changedBy')
            ->where('history.orderId', $orderId)->orderBy('history.createdAt')
            ->get(['history.*', 'actor.id as actorId', 'actor.displayName as actorName'])
            ->map(fn (object $item): array => [
                'id' => $item->id,
                'fromStatus' => $item->fromStatus,
                'toStatus' => $item->toStatus,
                'note' => $item->note,
                'createdAt' => $this->date($item->createdAt),
                'actor' => $item->actorId ? ['id' => $item->actorId, 'displayName' => $item->actorName] : null,
            ])->all();

        return ['data' => [...$this->response($order), 'history' => $history]];
    }

    public function accept(string $providerId, string $orderId): array
    {
        $order = $this->providerOrder($providerId, $orderId);
        if ($order->status !== 'REQUESTED') {
            throw $this->conflict('Only a requested order can be accepted');
        }
        DB::transaction(function () use ($providerId, $order): void {
            $profile = DB::table('ProviderProfile')->where('userId', $providerId)->lockForUpdate()->first();
            if (! $profile) {
                throw $this->conflict('Complete your provider profile first');
            }
            $active = DB::table('Order')->where('providerId', $providerId)->whereIn('status', self::ACTIVE_STATUSES)->count();
            if ($active >= (int) $profile->maxActiveOrders) {
                throw $this->conflict("You have reached your limit of {$profile->maxActiveOrders} active orders. Complete an active order before accepting another request.");
            }
            $this->changeStatus($order, $providerId, 'REQUESTED', 'ACCEPTED', 'Provider accepted the service request', ['acceptedAt' => now()]);
            $this->notification($order->clientId, $order->id, 'ORDER_ACCEPTED', 'Service request accepted', "Your request for {$order->titleSnapshot} was accepted.");
        });

        return ['data' => $this->response(DB::table('Order')->where('id', $orderId)->first()), 'message' => 'Request accepted and the client has been notified.'];
    }

    public function reject(string $providerId, string $orderId, string $reason): array
    {
        $order = $this->providerOrder($providerId, $orderId);
        if ($order->status !== 'REQUESTED') {
            throw $this->conflict('Only a requested order can be rejected');
        }
        DB::transaction(function () use ($providerId, $order, $reason): void {
            $this->changeStatus($order, $providerId, 'REQUESTED', 'REJECTED', trim($reason));
            $this->notification($order->clientId, $order->id, 'ORDER_REJECTED', 'Service request declined', "Your request for {$order->titleSnapshot} was declined. Reason: ".trim($reason));
        });

        return ['data' => $this->response(DB::table('Order')->where('id', $orderId)->first()), 'message' => 'Request declined and the client has been notified.'];
    }

    public function cancel(string $clientId, string $orderId, string $reason): array
    {
        $order = $this->clientOrder($clientId, $orderId);
        if ($order->status !== 'REQUESTED') {
            throw $this->conflict('Only a pending request can be cancelled');
        }
        DB::transaction(function () use ($clientId, $order, $reason): void {
            $this->changeStatus($order, $clientId, 'REQUESTED', 'CANCELLED', trim($reason));
            $this->notification($order->providerId, $order->id, 'ORDER_CANCELLED', 'Service request cancelled', "The client cancelled the request for {$order->titleSnapshot}. Reason: ".trim($reason));
        });

        return ['data' => $this->response(DB::table('Order')->where('id', $orderId)->first()), 'message' => 'Request cancelled and the provider has been notified.'];
    }

    public function start(string $providerId, string $orderId): array
    {
        $order = $this->providerOrder($providerId, $orderId);
        if ($order->status !== 'ACCEPTED') {
            throw $this->conflict('Only an accepted order can be started');
        }
        if (! DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->exists()) {
            throw $this->conflict('Wait for the client payment to be confirmed before starting work');
        }
        DB::transaction(function () use ($providerId, $order): void {
            $this->changeStatus($order, $providerId, 'ACCEPTED', 'IN_PROGRESS', 'Provider started working on the order', ['startedAt' => now()]);
            $this->notification($order->clientId, $order->id, 'ORDER_STARTED', 'Work has started', "Work has started on {$order->titleSnapshot}.");
        });

        return ['data' => $this->response(DB::table('Order')->where('id', $orderId)->first()), 'message' => 'Order started and the client has been notified.'];
    }

    /** @param list<UploadedFile> $files */
    public function deliver(string $providerId, string $orderId, string $note, array $files, ?string $clientRequestId): array
    {
        $order = $this->providerOrder($providerId, $orderId);
        $existing = $clientRequestId ? DB::table('DeliverySubmission')
            ->where('orderId', $orderId)->where('clientRequestId', $clientRequestId)->first() : null;
        if (! $existing && ! in_array($order->status, ['IN_PROGRESS', 'REVISION_REQUESTED'], true)) {
            throw $this->conflict('Only active work or a requested revision can be submitted');
        }
        if ($files === []) {
            throw $this->badRequest('Attach at least one deliverable file');
        }
        if (! $existing && ! DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->exists()) {
            throw $this->conflict('Payment must be confirmed before deliverables can be submitted');
        }

        $stored = [];
        try {
            foreach ($files as $file) {
                $saved = $this->storage->storeOrderFile($file);
                $stored[] = [
                    'storagePath' => $saved['key'],
                    'originalName' => $file->getClientOriginalName(),
                    'mimeType' => strtolower((string) $file->getMimeType()),
                    'sizeBytes' => (int) $file->getSize(),
                    'checksum' => $saved['checksum'],
                ];
            }
            $fingerprint = $clientRequestId ? $this->deliveryFingerprint(trim($note), $stored) : null;
            $result = DB::transaction(function () use ($providerId, $orderId, $note, $clientRequestId, $fingerprint, $stored): array {
                DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
                if ($clientRequestId) {
                    $duplicate = DB::table('DeliverySubmission')->where('orderId', $orderId)
                        ->where('clientRequestId', $clientRequestId)->first();
                    if ($duplicate) {
                        if (! hash_equals((string) $duplicate->requestFingerprint, (string) $fingerprint)) {
                            throw $this->conflict('This request identifier was already used for different delivery content');
                        }

                        return ['submission' => $duplicate, 'created' => false];
                    }
                }
                $current = $this->providerOrder($providerId, $orderId);
                if (! in_array($current->status, ['IN_PROGRESS', 'REVISION_REQUESTED'], true)) {
                    throw $this->conflict('Only active work or a requested revision can be submitted');
                }
                if (! DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->exists()) {
                    throw $this->conflict('Payment must be confirmed before deliverables can be submitted');
                }
                if (DB::table('OrderDispute')->where('orderId', $orderId)->whereIn('status', self::ACTIVE_DISPUTE_STATUSES)->exists()) {
                    throw $this->conflict('An active dispute blocks delivery resubmission');
                }
                $activeRevision = null;
                if ($current->status === 'REVISION_REQUESTED') {
                    $active = DB::table('RevisionRequest')->where('orderId', $orderId)->where('status', 'OPEN')->get();
                    if ($active->count() !== 1) {
                        throw $this->conflict('The active revision request cannot be identified safely');
                    }
                    $activeRevision = $active->first();
                    if ($activeRevision->type === 'PAID_EXTRA') {
                        $purchase = DB::table('OrderRevisionPurchase')->where('revisionRequestId', $activeRevision->id)->first();
                        if (! $purchase || $purchase->paymentStatus !== 'PAID' || $purchase->activationStatus !== 'ACTIVATED') {
                            throw $this->conflict('The paid extra revision is not authoritatively active');
                        }
                    }
                }
                $version = ((int) (DB::table('DeliverySubmission')->where('orderId', $orderId)->max('version') ?? 0)) + 1;
                $submissionId = (string) Str::uuid();
                $submittedAt = now();
                DB::table('DeliverySubmission')->insert([
                    'id' => $submissionId, 'orderId' => $orderId, 'providerId' => $providerId,
                    'version' => $version, 'note' => trim($note), 'clientRequestId' => $clientRequestId,
                    'requestFingerprint' => $fingerprint, 'revisionRequestId' => $activeRevision?->id,
                    'submittedAt' => $submittedAt, 'createdAt' => $submittedAt,
                ]);
                $purpose = $current->status === 'REVISION_REQUESTED' ? 'REVISION' : 'DELIVERABLE';
                foreach ($stored as $file) {
                    DB::table('OrderFile')->insert([
                        'id' => (string) Str::uuid(), 'orderId' => $orderId, 'deliverySubmissionId' => $submissionId,
                        'uploadedBy' => $providerId, 'purpose' => $purpose, ...$file, 'createdAt' => $submittedAt,
                    ]);
                }
                $changed = DB::table('Order')->where('id', $orderId)->where('providerId', $providerId)
                    ->where('status', $current->status)->update([
                        'status' => 'SUBMITTED', 'submittedAt' => $submittedAt, 'reviewPolicyVersion' => 1,
                        'reviewStartedAt' => $submittedAt, 'reviewDeadlineAt' => $submittedAt->copy()->addHours(48),
                        'reviewDeliverySubmissionId' => $submissionId, 'completionSource' => null, 'updatedAt' => $submittedAt,
                    ]);
                if ($changed !== 1) {
                    throw $this->conflict('This order changed before the delivery was submitted');
                }
                if ($activeRevision) {
                    DB::table('RevisionRequest')->where('id', $activeRevision->id)->where('status', 'OPEN')
                        ->update(['status' => 'RESOLVED', 'resolvedAt' => $submittedAt]);
                }
                $this->history($orderId, $current->status, 'SUBMITTED', $providerId, trim($note));
                $this->notification($current->clientId, $orderId, 'DELIVERY_SUBMITTED',
                    $purpose === 'REVISION' ? 'Revised work submitted' : 'Your delivery is ready',
                    "Delivery version {$version} was submitted for {$current->titleSnapshot}.");

                return ['submission' => DB::table('DeliverySubmission')->where('id', $submissionId)->first(), 'created' => true];
            });
        } catch (\Throwable $error) {
            foreach ($stored as $file) {
                $this->storage->deleteOrderFile($file['storagePath']);
            }
            throw $error;
        }
        if (! $result['created']) {
            foreach ($stored as $file) {
                $this->storage->deleteOrderFile($file['storagePath']);
            }
        }

        return [
            'data' => $this->response(DB::table('Order')->where('id', $orderId)->first()),
            'message' => $result['created']
                ? "Delivery version {$result['submission']->version} submitted and the client has been notified."
                : "Delivery version {$result['submission']->version} was already received.",
        ];
    }

    public function requestRevision(string $clientId, string $orderId, string $instructions): array
    {
        $note = trim($instructions);
        DB::transaction(function () use ($clientId, $orderId, $note): void {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $order = $this->clientOrder($clientId, $orderId);
            if ($order->status !== 'SUBMITTED') {
                throw $this->conflict('A revision can only be requested for submitted work');
            }
            if ((int) $order->revisionsUsed >= (int) $order->revisionLimit) {
                throw $this->conflict('Included revisions are exhausted. Request an extra revision quote instead.');
            }
            $this->assertActionableReview($order);
            $turnaround = $this->revisionTurnaround($order);
            $sequence = ((int) (DB::table('RevisionRequest')->where('orderId', $orderId)->max('sequenceNumber') ?? 0)) + 1;
            $now = now();
            $changed = DB::table('Order')->where('id', $orderId)->where('clientId', $clientId)
                ->where('status', 'SUBMITTED')->where('revisionsUsed', $order->revisionsUsed)->update([
                    'status' => 'REVISION_REQUESTED', 'revisionsUsed' => DB::raw('revisionsUsed + 1'),
                    'reviewPolicyVersion' => null, 'reviewStartedAt' => null, 'reviewDeadlineAt' => null,
                    'reviewDeliverySubmissionId' => null, 'updatedAt' => $now,
                ]);
            if ($changed !== 1) {
                throw $this->conflict('This delivery has already been reviewed');
            }
            DB::table('RevisionRequest')->insert([
                'id' => (string) Str::uuid(), 'orderId' => $orderId, 'requestedBy' => $clientId,
                'sequenceNumber' => $sequence, 'type' => 'INCLUDED', 'instructions' => $note,
                'status' => 'OPEN', 'sourceDeliverySubmissionId' => $order->reviewDeliverySubmissionId,
                'revisionDeadlineAt' => $now->copy()->addMinutes($turnaround), 'turnaroundMinutes' => $turnaround,
                'createdAt' => $now,
            ]);
            $this->history($orderId, 'SUBMITTED', 'REVISION_REQUESTED', $clientId, "Included revision {$sequence}: {$note}");
            $this->notification($order->providerId, $orderId, 'REVISION_REQUESTED', 'Client requested a revision',
                "Revision {$sequence} was requested for {$order->titleSnapshot}.");
        });

        return ['data' => $this->response(DB::table('Order')->where('id', $orderId)->first()), 'message' => 'Revision requested and the provider has been notified.'];
    }

    public function requestProviderCorrection(string $clientId, string $orderId, string $instructions): array
    {
        $revisionId = DB::transaction(function () use ($clientId, $orderId, $instructions): string {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $order = $this->clientOrder($clientId, $orderId);
            $this->assertActionableReview($order);
            if (DB::table('RevisionRequest')->where('orderId', $orderId)
                ->where('sourceDeliverySubmissionId', $order->reviewDeliverySubmissionId)
                ->where('type', 'PROVIDER_CORRECTION')->exists()) {
                throw $this->conflict('A provider-correction claim was already recorded for this delivery');
            }
            $id = (string) Str::uuid();
            $now = now();
            DB::table('RevisionRequest')->insert([
                'id' => $id, 'orderId' => $orderId, 'requestedBy' => $clientId,
                'sequenceNumber' => ((int) (DB::table('RevisionRequest')->where('orderId', $orderId)->max('sequenceNumber') ?? 0)) + 1,
                'type' => 'PROVIDER_CORRECTION', 'instructions' => trim($instructions),
                'status' => 'AWAITING_PROVIDER_ACKNOWLEDGEMENT',
                'sourceDeliverySubmissionId' => $order->reviewDeliverySubmissionId,
                'turnaroundMinutes' => $this->revisionTurnaround($order), 'createdAt' => $now,
            ]);
            $this->notification($order->providerId, $orderId, 'PROVIDER_CORRECTION_REVIEW',
                'Correction acknowledgement requested',
                "The client says the delivery for {$order->titleSnapshot} does not match the original requirements. Review and acknowledge or decline the correction request.");

            return $id;
        });

        return [
            'data' => $this->revisionResponse(DB::table('RevisionRequest')->where('id', $revisionId)->first()),
            'message' => 'Correction claim recorded. It becomes a free provider correction only if the provider acknowledges it; otherwise you may open a dispute.',
        ];
    }

    public function decideProviderCorrection(string $providerId, string $orderId, string $revisionId, bool $accepted): array
    {
        $revision = DB::transaction(function () use ($providerId, $orderId, $revisionId, $accepted): object {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $order = $this->providerOrder($providerId, $orderId);
            $revision = DB::table('RevisionRequest')->where('id', $revisionId)->where('orderId', $orderId)
                ->where('type', 'PROVIDER_CORRECTION')->where('status', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT')->first();
            if (! $revision) {
                throw $this->notFound('Correction claim not found');
            }
            $now = now();
            if (! $accepted) {
                DB::table('RevisionRequest')->where('id', $revisionId)->where('status', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT')
                    ->update(['status' => 'DECLINED', 'declinedAt' => $now]);
                $this->notification($order->clientId, $orderId, 'PROVIDER_CORRECTION_DECLINED',
                    'Correction claim was not acknowledged',
                    "The provider did not acknowledge the correction claim for {$order->titleSnapshot}. You may use the dispute path if the original requirements were not met.");

                return DB::table('RevisionRequest')->where('id', $revisionId)->first();
            }
            $this->assertActionableReview($order, $revisionId);
            if ($revision->sourceDeliverySubmissionId !== $order->reviewDeliverySubmissionId) {
                throw $this->conflict('This correction claim targets an older delivery');
            }
            $changed = DB::table('Order')->where('id', $orderId)->where('providerId', $providerId)
                ->where('status', 'SUBMITTED')->where('reviewDeliverySubmissionId', $revision->sourceDeliverySubmissionId)
                ->update([
                    'status' => 'REVISION_REQUESTED', 'reviewPolicyVersion' => null,
                    'reviewStartedAt' => null, 'reviewDeadlineAt' => null,
                    'reviewDeliverySubmissionId' => null, 'updatedAt' => $now,
                ]);
            if ($changed !== 1) {
                throw $this->conflict('This delivery has already changed');
            }
            DB::table('RevisionRequest')->where('id', $revisionId)->update([
                'status' => 'OPEN', 'providerAcknowledgedAt' => $now,
                'revisionDeadlineAt' => $now->copy()->addMinutes((int) $revision->turnaroundMinutes),
            ]);
            $this->history($orderId, 'SUBMITTED', 'REVISION_REQUESTED', $providerId,
                "Provider acknowledged correction {$revision->sequenceNumber}: {$revision->instructions}");
            $this->notification($order->clientId, $orderId, 'PROVIDER_CORRECTION_ACKNOWLEDGED',
                'Provider correction acknowledged',
                "The provider acknowledged the correction for {$order->titleSnapshot}. No included revision or payment was used.");

            return DB::table('RevisionRequest')->where('id', $revisionId)->first();
        });

        return [
            'data' => $this->revisionResponse($revision),
            'message' => $accepted
                ? 'Correction acknowledged. Submit corrected work by the revision deadline.'
                : 'Correction claim declined. The client may use the dispute path.',
        ];
    }

    public function getFile(string $userId, string $orderId, string $fileId): object
    {
        $order = $this->participantOrder($userId, $orderId);
        if ($order->clientId === $userId
            && ! DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->exists()) {
            throw $this->conflict('Payment must be confirmed before deliverables can be downloaded');
        }
        $file = DB::table('OrderFile')->where('id', $fileId)->where('orderId', $orderId)->first();
        if (! $file) {
            throw $this->notFound('Order file not found');
        }
        if ($file->deliverySubmissionId) {
            DB::table('DeliveryFileAccessAudit')->insert([
                'id' => (string) Str::uuid(), 'orderId' => $orderId,
                'deliverySubmissionId' => $file->deliverySubmissionId, 'fileId' => $fileId,
                'userId' => $userId, 'accessType' => 'ACCESS_GRANTED', 'accessedAt' => now(),
            ]);
        }

        return $file;
    }

    public function complete(string $clientId, string $orderId): array
    {
        $this->completeReviewedOrder($orderId, $clientId, 'CLIENT_ACCEPTED', CarbonImmutable::now());

        return ['data' => $this->response(DB::table('Order')->where('id', $orderId)->first()), 'message' => 'Delivery accepted. You can now review the provider.'];
    }

    public function reconcileExpiredReviews(int $limit = 25): int
    {
        $now = CarbonImmutable::now();
        $ids = DB::table('Order')->where('status', 'SUBMITTED')->where('reviewPolicyVersion', 1)
            ->whereNotNull('reviewDeliverySubmissionId')->where('reviewDeadlineAt', '<=', $now)
            ->orderBy('reviewDeadlineAt')->orderBy('id')->limit(min(max($limit, 1), 100))->pluck('id');
        $completed = 0;
        foreach ($ids as $id) {
            try {
                $this->completeReviewedOrder((string) $id, null, 'AUTO_REVIEW_TIMEOUT', $now);
                $completed++;
            } catch (HttpResponseException $error) {
                if ($error->getResponse()->getStatusCode() >= 500) {
                    throw $error;
                }
            }
        }

        return $completed;
    }

    public function reconcileExpiredReviewsForProvider(string $providerId, int $limit = 100): int
    {
        $now = CarbonImmutable::now();
        $ids = DB::table('Order')->where('providerId', $providerId)->where('status', 'SUBMITTED')
            ->where('reviewPolicyVersion', 1)->whereNotNull('reviewDeliverySubmissionId')
            ->where('reviewDeadlineAt', '<=', $now)->orderBy('reviewDeadlineAt')->orderBy('id')
            ->limit(min(max($limit, 1), 100))->pluck('id');
        $completed = 0;
        foreach ($ids as $id) {
            try {
                $this->completeReviewedOrder((string) $id, null, 'AUTO_REVIEW_TIMEOUT', $now);
                $completed++;
            } catch (HttpResponseException $error) {
                if ($error->getResponse()->getStatusCode() >= 500) {
                    throw $error;
                }
            }
        }

        return $completed;
    }

    private function completeReviewedOrder(string $orderId, ?string $clientId, string $source, CarbonImmutable $completedAt): void
    {
        DB::transaction(function () use ($clientId, $orderId, $source, $completedAt): void {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $order = $clientId ? $this->clientOrder($clientId, $orderId) : DB::table('Order')->where('id', $orderId)->first();
            if (! $order) {
                throw $this->notFound('Order not found');
            }
            if ($order->status === 'COMPLETED' && $order->completionSource) {
                if (DB::table('ProviderEarning')->where('orderId', $orderId)->where('status', '!=', 'AVAILABLE')->exists()) {
                    throw new \RuntimeException('Completed order earning release is inconsistent');
                }

                return;
            }
            if ($order->status !== 'SUBMITTED') {
                throw $this->conflict('Only submitted work can be accepted');
            }
            $latest = DB::table('DeliverySubmission')->where('orderId', $orderId)->orderByDesc('version')->first();
            if ((int) $order->reviewPolicyVersion !== 1 || ! $latest || ! $order->reviewStartedAt
                || ! $order->reviewDeadlineAt || $latest->id !== $order->reviewDeliverySubmissionId
                || CarbonImmutable::parse($latest->submittedAt)->getTimestamp() !== CarbonImmutable::parse($order->reviewStartedAt)->getTimestamp()) {
                throw $this->conflict('The active delivery review does not match the latest submission');
            }
            if ($source === 'AUTO_REVIEW_TIMEOUT'
                && $completedAt->lessThan(CarbonImmutable::parse($order->reviewDeadlineAt))) {
                throw $this->conflict('The delivery review period is still active');
            }
            if (DB::table('RevisionRequest')->where('orderId', $orderId)->where('status', 'OPEN')->exists()) {
                throw $this->conflict('An unresolved revision blocks completion');
            }
            if (DB::table('OrderDispute')->where('orderId', $orderId)->whereIn('status', self::ACTIVE_DISPUTE_STATUSES)->exists()) {
                throw $this->conflict('An active dispute blocks completion');
            }
            $payments = DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->get();
            if ($payments->count() !== 1 || (int) $payments->first()->refundedCentavos !== 0
                || DB::table('PaymentRefund')->where('paymentId', $payments->first()->id)->where('status', 'SUCCEEDED')->exists()) {
                throw $this->conflict('A confirmed, unreimbursed payment is required before completion');
            }
            $earnings = DB::table('ProviderEarning')->where('orderId', $orderId)->where('status', 'PENDING')->get();
            if ($earnings->isEmpty()) {
                throw new \RuntimeException('Provider earning is missing or does not match the paid order');
            }
            foreach ($earnings as $earning) {
                $pending = DB::table('ProviderEarningLedgerEntry')->where('providerEarningId', $earning->id)
                    ->where('type', 'EARNING_PENDING_CREDIT')->get();
                if ($pending->count() !== 1 || (int) $pending->first()->amountCentavos !== (int) $earning->grossServiceAmountCentavos
                    || $pending->first()->currency !== $earning->currency) {
                    throw new \RuntimeException('Provider earning cannot be reconciled for release');
                }
            }
            $changed = DB::table('Order')->where('id', $orderId)
                ->when($clientId, fn ($query) => $query->where('clientId', $clientId))
                ->where('status', 'SUBMITTED')->where('reviewDeliverySubmissionId', $latest->id)->update([
                    'status' => 'COMPLETED', 'completedAt' => $completedAt,
                    'completionSource' => $source, 'updatedAt' => $completedAt,
                ]);
            if ($changed !== 1) {
                throw $this->conflict('This delivery has already been reviewed');
            }
            foreach ($earnings as $earning) {
                if (DB::table('ProviderEarning')->where('id', $earning->id)->where('status', 'PENDING')->whereNull('availableAt')
                    ->update(['status' => 'AVAILABLE', 'availableAt' => $completedAt, 'updatedAt' => $completedAt]) !== 1) {
                    throw new \RuntimeException('Provider earning changed before it could be released');
                }
                DB::table('ProviderEarningLedgerEntry')->insert([
                    'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id,
                    'providerId' => $earning->providerId, 'orderId' => $orderId,
                    'sourcePaymentId' => null, 'sourceRevisionPurchaseId' => null,
                    'type' => 'EARNING_AVAILABLE_RELEASE', 'amountCentavos' => 0,
                    'currency' => $earning->currency, 'sourceKey' => "earning:{$earning->id}:available-release",
                    'createdAt' => $completedAt,
                ]);
            }
            $note = $source === 'CLIENT_ACCEPTED'
                ? 'Client accepted the delivery'
                : 'CampusGig completed the order after the 48-hour review period';
            $this->history($orderId, 'SUBMITTED', 'COMPLETED', $source === 'CLIENT_ACCEPTED' ? $clientId : null, $note);
            DB::table('StudentProfile')->where('userId', $order->providerId)->increment('completedOrderCount');
            if ($source === 'CLIENT_ACCEPTED') {
                $this->notification($order->providerId, $orderId, 'ORDER_COMPLETED', 'Delivery accepted',
                    "The client accepted your delivery for {$order->titleSnapshot}. Your earning is now available in CampusGig.");
            } else {
                $this->notification($order->providerId, $orderId, 'ORDER_AUTO_COMPLETED', 'Review period completed',
                    "{$order->titleSnapshot} was completed after the 48-hour review period. Your earning is now available in CampusGig.");
                $this->notification($order->clientId, $orderId, 'ORDER_AUTO_COMPLETED', 'Order completed automatically',
                    "{$order->titleSnapshot} was completed after the 48-hour review period.");
            }
        });
    }

    public function review(string $clientId, string $orderId, array $input): array
    {
        $order = $this->clientOrder($clientId, $orderId);
        if ($order->status !== 'COMPLETED') {
            throw $this->conflict('Complete the order before leaving a review');
        }
        if (! DB::table('Payment')->where('orderId', $orderId)->where('status', 'PAID')->exists()) {
            throw $this->conflict('Payment must be confirmed before the provider can be reviewed');
        }
        try {
            $review = DB::transaction(function () use ($clientId, $order, $input): object {
                DB::table('StudentProfile')->where('userId', $order->providerId)->lockForUpdate()->first();
                $id = (string) Str::uuid();
                DB::table('Review')->insert([
                    'id' => $id, 'orderId' => $order->id, 'reviewerId' => $clientId, 'revieweeId' => $order->providerId,
                    'overallRating' => $input['overallRating'], 'qualityRating' => $input['qualityRating'] ?? null,
                    'communicationRating' => $input['communicationRating'] ?? null,
                    'timelinessRating' => $input['timelinessRating'] ?? null,
                    'comment' => filled($input['comment'] ?? null) ? trim($input['comment']) : null, 'createdAt' => now(),
                ]);
                $aggregate = DB::table('Review')->where('revieweeId', $order->providerId)
                    ->selectRaw('AVG(overallRating) as averageRating, COUNT(*) as reviewCount')->first();
                DB::table('StudentProfile')->where('userId', $order->providerId)->update([
                    'ratingAverage' => $aggregate->averageRating ?? 0, 'reviewCount' => $aggregate->reviewCount,
                ]);
                $this->notification($order->providerId, $order->id, 'NEW_REVIEW', 'You received a review',
                    "The client rated {$order->titleSnapshot} {$input['overallRating']} out of 5.");

                return DB::table('Review')->where('id', $id)->first();
            });
        } catch (QueryException $error) {
            if ($this->isUniqueViolation($error)) {
                throw $this->conflict('This order has already been reviewed');
            }
            throw $error;
        }

        return ['data' => $this->reviewResponse($review), 'message' => 'Thank you for reviewing the provider.'];
    }

    public function updateVisibility(string $userId, string $orderId, string $action): array
    {
        $order = $this->participantOrder($userId, $orderId);
        if ($order->status !== 'COMPLETED') {
            throw $this->conflict('Only completed orders can be archived or removed');
        }
        $client = $order->clientId === $userId;
        $archived = $client ? 'clientArchivedAt' : 'providerArchivedAt';
        $removed = $client ? 'clientRemovedAt' : 'providerRemovedAt';
        $query = DB::table('Order')->where('id', $orderId)->where($client ? 'clientId' : 'providerId', $userId)
            ->where('status', 'COMPLETED')->whereNull($removed);
        if ($action === 'restore') {
            $query->whereNotNull($archived);
        }
        $changes = match ($action) {
            'archive' => [$archived => now()],
            'restore' => [$archived => null],
            default => [$removed => now()],
        };
        if ($query->update([...$changes, 'updatedAt' => now()]) !== 1) {
            throw $this->conflict('This order is no longer available in your list');
        }

        return ['data' => ['id' => $orderId, 'view' => $action === 'archive' ? 'archived' : ($action === 'restore' ? 'active' : 'removed')]];
    }

    private function singlePriceTerms(object $service, array $input): array
    {
        if (isset($input['servicePackageId'])) {
            throw $this->badRequest('Single-price orders do not use a service package');
        }
        if (isset($input['requestedDeliveryDate'])) {
            throw $this->badRequest('Single-price delivery starts after payment confirmation');
        }
        if (! isset($input['deliveryOption'])) {
            throw $this->badRequest('Select a delivery option');
        }
        $quote = $this->pricing->quote([
            'basePriceCentavos' => (int) $service->basePriceCentavos,
            'normalDeliveryMinutes' => (int) $service->normalDeliveryMinutes,
            'includedRevisionLimit' => (int) $service->includedRevisionLimit,
            'acceptsRushOrders' => (bool) $service->acceptsRushOrders,
            'fastestRushTier' => $service->fastestRushTier,
        ], $input['deliveryOption']);
        $requirements = trim($input['requirements']);
        $label = $this->deliveryOptionLabel($quote['deliveryOption']);
        $snapshot = [
            'version' => 2,
            'pricingModel' => 'SINGLE_PRICE_V2',
            'pricingPolicyVersion' => $quote['pricingPolicyVersion'],
            'service' => ['id' => $service->id, 'title' => $service->title, 'providerId' => $service->providerId],
            'pricing' => [
                'currency' => 'PHP', 'basePriceCentavos' => $quote['basePriceCentavos'],
                'rushBasisPoints' => $quote['rushBasisPoints'], 'rushSurchargeCentavos' => $quote['rushSurchargeCentavos'],
                'providerServiceSubtotalCentavos' => $quote['providerServiceSubtotalCentavos'],
                'platformFeeBasisPoints' => $quote['platformFeeBasisPoints'], 'platformFeeCentavos' => $quote['platformFeeCentavos'],
                'clientTotalCentavos' => $quote['clientTotalCentavos'],
            ],
            'delivery' => [
                'option' => $quote['deliveryOption'], 'durationMinutes' => $quote['deliveryDurationMinutes'],
                'startsAfterPaymentConfirmation' => true,
            ],
            'includedRevisionLimit' => (int) $service->includedRevisionLimit,
            'requirements' => $requirements,
        ];

        return [
            'servicePackageId' => null, 'pricingModel' => 'SINGLE_PRICE_V2', 'packageSnapshot' => null,
            'termsSnapshot' => $snapshot, 'basePriceCentavos' => $quote['basePriceCentavos'],
            'rushSurchargeCentavos' => $quote['rushSurchargeCentavos'], 'deliveryOption' => $quote['deliveryOption'],
            'deliveryDurationMinutes' => $quote['deliveryDurationMinutes'], 'pricingPolicyVersion' => $quote['pricingPolicyVersion'],
            'platformFeeBasisPoints' => $quote['platformFeeBasisPoints'], 'rushBasisPoints' => $quote['rushBasisPoints'],
            'subtotalCentavos' => $quote['providerServiceSubtotalCentavos'], 'platformFeeCentavos' => $quote['platformFeeCentavos'],
            'totalCentavos' => $quote['clientTotalCentavos'], 'dueAt' => null,
            'revisionLimit' => (int) $service->includedRevisionLimit,
            'historyNote' => "{$label} selected; deadline starts after payment confirmation",
            'notificationSuffix' => 'The deadline starts after payment confirmation.',
        ];
    }

    private function legacyTerms(object $service, array $input): array
    {
        if (! isset($input['servicePackageId'])) {
            throw $this->badRequest('Select a service package');
        }
        if (isset($input['deliveryOption'])) {
            throw $this->badRequest('Legacy package orders cannot include a V2 delivery option');
        }
        $package = DB::table('ServicePackage')->where('id', $input['servicePackageId'])
            ->where('serviceId', $service->id)->where('isActive', true)->first();
        if (! $package) {
            throw $this->badRequest('Selected package is no longer available');
        }
        $dueAt = $this->requestedDueAt($input['requestedDeliveryDate'] ?? null, (int) $package->deliveryDays);
        $fee = $this->pricing->platformFee((int) $package->priceCentavos);
        $packageSnapshot = [
            'tier' => $package->tier, 'name' => $package->name, 'description' => $package->description,
            'priceCentavos' => (int) $package->priceCentavos, 'deliveryDays' => (int) $package->deliveryDays,
            'revisionLimit' => (int) $package->revisionLimit,
        ];
        $total = (int) $package->priceCentavos + $fee;
        $termsSnapshot = [
            'version' => 1,
            'pricingModel' => 'LEGACY_PACKAGE_V1',
            'service' => ['title' => $service->title],
            'package' => ['id' => $package->id, ...$packageSnapshot],
            'pricing' => [
                'currency' => 'PHP', 'subtotalCentavos' => (int) $package->priceCentavos,
                'platformFeeCentavos' => $fee, 'totalCentavos' => $total,
            ],
            'fulfillment' => [
                'deliveryDays' => (int) $package->deliveryDays, 'revisionLimit' => (int) $package->revisionLimit,
                'dueAt' => $dueAt->toISOString(), 'deadlineBasis' => 'STORED_DUE_AT',
            ],
        ];
        $label = $dueAt->setTimezone('Asia/Manila')->format('M j, Y');

        return [
            'servicePackageId' => $package->id, 'pricingModel' => 'LEGACY_PACKAGE_V1',
            'packageSnapshot' => $packageSnapshot, 'termsSnapshot' => $termsSnapshot,
            'basePriceCentavos' => null, 'rushSurchargeCentavos' => null, 'deliveryOption' => null,
            'deliveryDurationMinutes' => null, 'pricingPolicyVersion' => null, 'platformFeeBasisPoints' => null,
            'rushBasisPoints' => null, 'subtotalCentavos' => (int) $package->priceCentavos,
            'platformFeeCentavos' => $fee, 'totalCentavos' => $total, 'dueAt' => $dueAt,
            'revisionLimit' => (int) $package->revisionLimit,
            'historyNote' => "Client requested delivery by {$label}",
            'notificationSuffix' => "Requested delivery: {$label}.",
        ];
    }

    private function response(object $order): array
    {
        $client = DB::table('User')->where('id', $order->clientId)->first();
        $provider = DB::table('User')->where('id', $order->providerId)->first();
        $payment = DB::table('Payment')->where('orderId', $order->id)->orderByDesc('createdAt')->first();
        $review = DB::table('Review')->where('orderId', $order->id)->first();
        $files = DB::table('OrderFile')->where('orderId', $order->id)->orderBy('createdAt')->get();
        $submissions = DB::table('DeliverySubmission')->where('orderId', $order->id)->orderByDesc('version')->get();
        $revisionPurchases = DB::table('OrderRevisionPurchase')->where('orderId', $order->id)->orderBy('createdAt')->get()
            ->map(fn (object $purchase): array => [
                'id' => $purchase->id, 'orderId' => $purchase->orderId,
                'sourceDeliverySubmissionId' => $purchase->sourceDeliverySubmissionId,
                'revisionRequestId' => $purchase->revisionRequestId, 'instructions' => $purchase->instructions,
                'providerSubtotalCentavos' => (int) $purchase->providerSubtotalCentavos,
                'platformFeeCentavos' => (int) $purchase->platformFeeCentavos,
                'totalCentavos' => (int) $purchase->totalCentavos, 'currency' => $purchase->currency,
                'turnaroundMinutes' => (int) $purchase->turnaroundMinutes,
                'pricingPolicyVersion' => (int) $purchase->pricingPolicyVersion,
                'paymentStatus' => $purchase->paymentStatus, 'activationStatus' => $purchase->activationStatus,
                'failureCode' => $purchase->failureCode, 'paidAt' => $this->date($purchase->paidAt),
                'activatedAt' => $this->date($purchase->activatedAt), 'createdAt' => $this->date($purchase->createdAt),
            ]);
        $deliverySubmissions = $submissions->values()->map(function (object $submission, int $index) use ($files): array {
            return [
                'id' => $submission->id,
                'providerId' => $submission->providerId,
                'version' => (int) $submission->version,
                'note' => $submission->note,
                'revisionRequestId' => $submission->revisionRequestId,
                'submittedAt' => $this->date($submission->submittedAt),
                'createdAt' => $this->date($submission->createdAt),
                'isCurrent' => $index === 0,
                'files' => $files->where('deliverySubmissionId', $submission->id)->values()
                    ->map(fn (object $file): array => $this->fileResponse($file))->all(),
            ];
        })->all();
        $revisions = DB::table('RevisionRequest')->where('orderId', $order->id)->orderBy('sequenceNumber')->get()
            ->map(fn (object $revision): array => [
                'id' => $revision->id, 'sequenceNumber' => (int) $revision->sequenceNumber,
                'type' => $revision->type, 'instructions' => $revision->instructions, 'status' => $revision->status,
                'sourceDeliverySubmissionId' => $revision->sourceDeliverySubmissionId,
                'revisionDeadlineAt' => $this->date($revision->revisionDeadlineAt),
                'turnaroundMinutes' => $revision->turnaroundMinutes === null ? null : (int) $revision->turnaroundMinutes,
                'providerAcknowledgedAt' => $this->date($revision->providerAcknowledgedAt),
                'declinedAt' => $this->date($revision->declinedAt), 'createdAt' => $this->date($revision->createdAt),
                'resolvedAt' => $this->date($revision->resolvedAt),
                'purchase' => $revisionPurchases->firstWhere('revisionRequestId', $revision->id),
            ])->all();
        $hasBlockingDispute = DB::table('OrderDispute')->where('orderId', $order->id)
            ->whereIn('status', self::ACTIVE_DISPUTE_STATUSES)->exists();
        $reviewState = (int) ($order->reviewPolicyVersion ?? 0) !== 1 ? null
            : ($order->status === 'COMPLETED' ? 'COMPLETED'
                : ($order->status === 'SUBMITTED' ? ($hasBlockingDispute ? 'BLOCKED_BY_DISPUTE' : 'ACTIVE') : 'SUPERSEDED'));
        $snapshot = $this->json($order->termsSnapshot);
        $package = null;
        if (($order->pricingModel ?? 'LEGACY_PACKAGE_V1') === 'LEGACY_PACKAGE_V1') {
            $package = $snapshot['package'] ?? ($order->servicePackageId
                ? (array) DB::table('ServicePackage')->where('id', $order->servicePackageId)->first()
                : null);
        }

        return [
            'id' => $order->id,
            'orderNumber' => $order->orderNumber,
            'title' => $order->titleSnapshot,
            'status' => $order->status,
            'pricingModel' => $order->pricingModel ?? 'LEGACY_PACKAGE_V1',
            'termsSnapshotVersion' => is_int($snapshot['version'] ?? null) ? $snapshot['version'] : 1,
            'requirements' => $order->requirements,
            'subtotalCentavos' => (int) $order->subtotalCentavos,
            'platformFeeCentavos' => (int) $order->platformFeeCentavos,
            'totalCentavos' => (int) $order->totalCentavos,
            'currency' => $order->currency,
            'dueAt' => $this->date($order->dueAt),
            'reviewPolicyVersion' => $order->reviewPolicyVersion === null ? null : (int) $order->reviewPolicyVersion,
            'reviewStartedAt' => $this->date($order->reviewStartedAt),
            'reviewDeadlineAt' => $this->date($order->reviewDeadlineAt),
            'reviewDeliverySubmissionId' => $order->reviewDeliverySubmissionId,
            'reviewState' => $reviewState,
            'reviewActionable' => $reviewState === 'ACTIVE',
            'completionSource' => $order->completionSource,
            'completedAt' => $this->date($order->completedAt),
            'paymentConfirmedAt' => $this->date($payment->paidAt ?? null),
            'basePriceCentavos' => $order->basePriceCentavos === null ? null : (int) $order->basePriceCentavos,
            'rushSurchargeCentavos' => $order->rushSurchargeCentavos === null ? null : (int) $order->rushSurchargeCentavos,
            'deliveryOption' => $order->deliveryOption,
            'deliveryDurationMinutes' => $order->deliveryDurationMinutes === null ? null : (int) $order->deliveryDurationMinutes,
            'pricingPolicyVersion' => $order->pricingPolicyVersion === null ? null : (int) $order->pricingPolicyVersion,
            'platformFeeBasisPoints' => $order->platformFeeBasisPoints === null ? null : (int) $order->platformFeeBasisPoints,
            'rushBasisPoints' => $order->rushBasisPoints === null ? null : (int) $order->rushBasisPoints,
            'createdAt' => $this->date($order->createdAt),
            'revisionsUsed' => (int) $order->revisionsUsed,
            'revisionLimit' => (int) $order->revisionLimit,
            'files' => $files->map(fn (object $file): array => $this->fileResponse($file))->all(),
            'deliverySubmissions' => $deliverySubmissions,
            'currentDeliverySubmission' => $deliverySubmissions[0] ?? null,
            'revisions' => $revisions,
            'revisionPurchases' => $revisionPurchases->values()->all(),
            'review' => $review ? $this->reviewResponse($review) : null,
            'paymentStatus' => $payment->status ?? null,
            'client' => $this->party($client),
            'provider' => $this->party($provider),
            ...($package === null ? [] : ['package' => $package]),
        ];
    }

    private function fileResponse(object $file): array
    {
        return [
            'id' => $file->id, 'purpose' => $file->purpose, 'originalName' => $file->originalName,
            'mimeType' => $file->mimeType, 'sizeBytes' => (int) $file->sizeBytes,
            'sha256' => $file->checksum, 'createdAt' => $this->date($file->createdAt),
        ];
    }

    private function reviewResponse(object $review): array
    {
        return [
            'id' => $review->id, 'overallRating' => (int) $review->overallRating,
            'qualityRating' => $review->qualityRating === null ? null : (int) $review->qualityRating,
            'communicationRating' => $review->communicationRating === null ? null : (int) $review->communicationRating,
            'timelinessRating' => $review->timelinessRating === null ? null : (int) $review->timelinessRating,
            'comment' => $review->comment, 'createdAt' => $this->date($review->createdAt),
        ];
    }

    private function party(?object $user): array
    {
        return [
            'id' => $user?->id ?? '', 'displayName' => $user?->displayName ?? '',
            'hasAvatar' => filled($user?->avatarPath),
            'avatarVersion' => $user?->updatedAt ? CarbonImmutable::parse($user->updatedAt)->getTimestampMs() : 0,
        ];
    }

    private function changeStatus(object $order, string $actorId, string $from, string $to, string $note, array $extra = []): void
    {
        $changed = DB::table('Order')->where('id', $order->id)->where('status', $from)
            ->update(['status' => $to, ...$extra, 'updatedAt' => now()]);
        if ($changed !== 1) {
            throw $this->conflict('This order has already been updated');
        }
        $this->history($order->id, $from, $to, $actorId, $note);
    }

    private function history(string $orderId, ?string $from, string $to, ?string $actorId, ?string $note): void
    {
        DB::table('OrderStatusHistory')->insert([
            'id' => (string) Str::uuid(), 'orderId' => $orderId, 'fromStatus' => $from,
            'toStatus' => $to, 'changedBy' => $actorId, 'note' => $note, 'createdAt' => now(),
        ]);
    }

    private function notification(string $recipientId, string $orderId, string $type, string $title, string $body): void
    {
        DB::table('Notification')->insert([
            'id' => (string) Str::uuid(), 'recipientId' => $recipientId, 'orderId' => $orderId,
            'type' => $type, 'title' => $title, 'body' => $body, 'createdAt' => now(),
        ]);
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

    private function providerOrder(string $providerId, string $orderId): object
    {
        $order = DB::table('Order')->where('id', $orderId)->where('providerId', $providerId)->first();
        if (! $order) {
            throw $this->notFound('Order not found');
        }

        return $order;
    }

    private function clientOrder(string $clientId, string $orderId): object
    {
        $order = DB::table('Order')->where('id', $orderId)->where('clientId', $clientId)->first();
        if (! $order) {
            throw $this->notFound('Order not found');
        }

        return $order;
    }

    private function findByRequestId(string $clientId, string $requestId): ?object
    {
        return DB::table('Order')->where('clientId', $clientId)->where('clientRequestId', $requestId)->first();
    }

    private function idempotentResponse(object $order, ?string $fingerprint): array
    {
        if (! hash_equals((string) $order->requestFingerprint, (string) $fingerprint)) {
            throw $this->conflict('This request identifier was already used for different order details');
        }

        return ['data' => $this->response($order), 'message' => 'This service request was already received.'];
    }

    private function fingerprint(array $input): string
    {
        return hash('sha256', json_encode([
            'serviceId' => $input['serviceId'],
            'servicePackageId' => $input['servicePackageId'] ?? null,
            'deliveryOption' => $input['deliveryOption'] ?? null,
            'requirements' => trim($input['requirements']),
            'requestedDeliveryDate' => $input['requestedDeliveryDate'] ?? null,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    /** @param list<array{originalName: string, mimeType: string, sizeBytes: int, checksum: string, storagePath: string}> $files */
    private function deliveryFingerprint(string $note, array $files): string
    {
        return hash('sha256', json_encode([
            'note' => $note,
            'files' => array_map(fn (array $file): array => [
                'originalName' => $file['originalName'], 'mimeType' => $file['mimeType'],
                'sizeBytes' => $file['sizeBytes'], 'checksum' => $file['checksum'],
            ], $files),
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function assertActionableReview(object $order, ?string $ignoredRevisionId = null): void
    {
        if ($order->status !== 'SUBMITTED') {
            throw $this->conflict('A revision can only be requested for submitted work');
        }
        $latest = DB::table('DeliverySubmission')->where('orderId', $order->id)->orderByDesc('version')->first();
        if ((int) ($order->reviewPolicyVersion ?? 0) !== 1 || ! $order->reviewDeadlineAt
            || ! $order->reviewDeliverySubmissionId || ! $latest
            || $latest->id !== $order->reviewDeliverySubmissionId) {
            throw $this->conflict('This delivery does not have an actionable Phase F review');
        }
        if (now()->greaterThanOrEqualTo(CarbonImmutable::parse($order->reviewDeadlineAt))) {
            throw $this->conflict('The delivery review period has ended');
        }
        $payments = DB::table('Payment')->where('orderId', $order->id)->where('status', 'PAID')->get();
        if ($payments->count() !== 1 || (int) ($payments->first()->refundedCentavos ?? 0) !== 0
            || DB::table('PaymentRefund')->where('paymentId', $payments->first()->id)->where('status', 'SUCCEEDED')->exists()) {
            throw $this->conflict('A confirmed, unreimbursed order payment is required');
        }
        $activeRevision = DB::table('RevisionRequest')->where('orderId', $order->id)
            ->whereIn('status', ['OPEN', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT']);
        if ($ignoredRevisionId) {
            $activeRevision->where('id', '!=', $ignoredRevisionId);
        }
        if ($activeRevision->exists()) {
            throw $this->conflict('Another revision request is already active');
        }
        if (DB::table('OrderDispute')->where('orderId', $order->id)->whereIn('status', self::ACTIVE_DISPUTE_STATUSES)->exists()) {
            throw $this->conflict('An active dispute blocks revision changes');
        }
    }

    private function revisionResponse(object $revision): array
    {
        return [
            'id' => $revision->id, 'sequenceNumber' => (int) $revision->sequenceNumber,
            'type' => $revision->type, 'instructions' => $revision->instructions, 'status' => $revision->status,
            'sourceDeliverySubmissionId' => $revision->sourceDeliverySubmissionId,
            'revisionDeadlineAt' => $this->date($revision->revisionDeadlineAt),
            'turnaroundMinutes' => $revision->turnaroundMinutes === null ? null : (int) $revision->turnaroundMinutes,
            'providerAcknowledgedAt' => $this->date($revision->providerAcknowledgedAt),
            'declinedAt' => $this->date($revision->declinedAt), 'createdAt' => $this->date($revision->createdAt),
            'resolvedAt' => $this->date($revision->resolvedAt), 'purchase' => null,
        ];
    }

    private function revisionTurnaround(object $order): int
    {
        $duration = $order->pricingModel === 'SINGLE_PRICE_V2'
            ? $order->deliveryDurationMinutes
            : ($this->json($order->termsSnapshot)['package']['deliveryDays'] ?? null) * 1440;
        if (! is_numeric($duration) || (int) $duration <= 0) {
            throw $this->conflict('This order does not have trustworthy delivery-duration evidence for a revision deadline');
        }

        return min(4320, max(180, (int) ceil(((int) $duration) * 0.5)));
    }

    private function requestedDueAt(?string $requested, int $deliveryDays): CarbonImmutable
    {
        $today = CarbonImmutable::now('Asia/Manila')->startOfDay();
        $earliest = $today->addDays($deliveryDays);
        $latest = $today->addDays(365);
        if ($requested === null) {
            $date = $earliest;
        } else {
            $date = CarbonImmutable::createFromFormat('!Y-m-d', $requested, 'Asia/Manila');
            $errors = CarbonImmutable::getLastErrors();
            if (! $date || is_array($errors) && ($errors['warning_count'] > 0 || $errors['error_count'] > 0) || $date->format('Y-m-d') !== $requested) {
                throw $this->badRequest('Requested delivery date is invalid');
            }
        }
        if ($date->lt($earliest)) {
            throw $this->badRequest("Requested delivery date must allow at least {$deliveryDays} delivery day".($deliveryDays === 1 ? '' : 's'));
        }
        if ($date->gt($latest)) {
            throw $this->badRequest('Requested delivery date cannot be more than 365 days ahead');
        }

        return $date->endOfDay()->utc();
    }

    private function deliveryOptionLabel(string $option): string
    {
        return match ($option) {
            'RUSH_24_HOURS' => '24-hour rush', 'RUSH_12_HOURS' => '12-hour rush',
            'RUSH_6_HOURS' => '6-hour rush', 'RUSH_3_HOURS' => '3-hour rush', default => 'Normal delivery',
        };
    }

    private function encodeCursor(mixed $createdAt, string $id): string
    {
        $json = json_encode(['createdAt' => CarbonImmutable::parse($createdAt)->toISOString(), 'id' => $id], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    private function decodeCursor(string $cursor): array
    {
        $decoded = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = $decoded === false ? null : json_decode($decoded, true);
        if (! is_array($value) || ! is_string($value['createdAt'] ?? null) || ! is_string($value['id'] ?? null)) {
            throw $this->badRequest('Invalid order cursor');
        }
        try {
            return [CarbonImmutable::parse($value['createdAt']), $value['id']];
        } catch (\Throwable) {
            throw $this->badRequest('Invalid order cursor');
        }
    }

    private function json(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function date(mixed $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->toISOString() : null;
    }

    private function isUniqueViolation(QueryException $error): bool
    {
        return in_array((string) $error->getCode(), ['23000', '23505'], true);
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
        return new HttpResponseException(response()->json([
            'message' => $message, 'error' => $error, 'statusCode' => $status,
        ], $status));
    }
}
