<?php

namespace App\Services;

use App\Services\Storage\PrivateMediaStorage;
use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class DisputeService
{
    private const ACTIVE_STATUSES = ['OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW'];

    private const FINAL_STATUSES = ['RESOLVED_CLIENT', 'RESOLVED_PROVIDER', 'CLOSED'];

    private const DISPUTABLE_ORDER_STATUSES = ['ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED'];

    public function __construct(private readonly PrivateMediaStorage $storage) {}

    public function forOrder(string $userId, string $orderId): array
    {
        $this->participantOrder($userId, $orderId);
        $this->reconcileExpiredForOrder($orderId);
        $dispute = DB::table('OrderDispute')->where('orderId', $orderId)
            ->orderByDesc('createdAt')->orderByDesc('id')->first();

        return ['data' => $dispute ? $this->response($dispute) : null];
    }

    /** @param list<UploadedFile> $files */
    public function open(string $userId, string $orderId, string $reason, string $details, array $files): array
    {
        $this->participantOrder($userId, $orderId);
        $evidence = $this->persistEvidence($files);
        $now = CarbonImmutable::now();
        try {
            $disputeId = DB::transaction(function () use ($userId, $orderId, $reason, $details, $evidence, $now): string {
                $order = DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
                if (! $order || ($order->clientId !== $userId && $order->providerId !== $userId)) {
                    throw $this->notFound('Order not found');
                }
                if (! in_array($order->status, self::DISPUTABLE_ORDER_STATUSES, true)) {
                    throw $this->conflict('A dispute can only be opened after a request is accepted');
                }
                if (DB::table('OrderDispute')->where('orderId', $orderId)->whereIn('status', self::ACTIVE_STATUSES)->exists()) {
                    throw $this->conflict('This order already has an active dispute');
                }
                if ($order->status === 'COMPLETED' && $order->completionSource === 'CLIENT_ACCEPTED'
                    && ! in_array($reason, ['PAYMENT_ISSUE', 'CONDUCT'], true)) {
                    throw $this->conflict('After explicit acceptance, only payment or conduct escalations can be reviewed');
                }

                $latestDelivery = DB::table('DeliverySubmission')->where('orderId', $orderId)
                    ->orderByDesc('version')->orderByDesc('id')->first();
                $activeRevision = $order->status === 'REVISION_REQUESTED'
                    ? DB::table('RevisionRequest')->where('orderId', $orderId)
                        ->whereIn('status', ['OPEN', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT'])
                        ->orderByDesc('createdAt')->orderByDesc('id')->first()
                    : null;
                $targetDeliveryId = $activeRevision?->sourceDeliverySubmissionId
                    ?? $order->reviewDeliverySubmissionId ?? $latestDelivery?->id;
                $targetRevision = $activeRevision;
                if (! $targetRevision && $targetDeliveryId) {
                    $targetRevision = DB::table('RevisionRequest')->where('orderId', $orderId)
                        ->where('sourceDeliverySubmissionId', $targetDeliveryId)
                        ->orderByDesc('createdAt')->orderByDesc('id')->first();
                }
                $purchase = $targetRevision
                    ? DB::table('OrderRevisionPurchase')->where('revisionRequestId', $targetRevision->id)->first()
                    : null;
                $earningQuery = DB::table('ProviderEarning')->where('orderId', $orderId);
                $earning = $purchase
                    ? $earningQuery->where('sourceType', 'PAID_EXTRA_REVISION')->where('revisionPurchaseId', $purchase->id)->first()
                    : $earningQuery->where('sourceType', 'ORIGINAL_ORDER')->first();
                if ($purchase && ! $earning) {
                    throw $this->conflict('The paid revision earning cannot be identified safely');
                }
                if ($earning && ! in_array($earning->status, ['PENDING', 'AVAILABLE'], true)) {
                    throw $this->conflict('The affected earning cannot enter a dispute freeze from its current state');
                }

                $id = (string) Str::uuid();
                $requestedFrom = $order->clientId === $userId ? 'PROVIDER' : 'CLIENT';
                $deadline = $now->addHours(48);
                $remaining = $order->status === 'SUBMITTED' && $order->reviewDeadlineAt
                    ? max(0, (int) ceil($now->diffInSeconds(CarbonImmutable::parse($order->reviewDeadlineAt), false)))
                    : null;
                DB::table('OrderDispute')->insert([
                    'id' => $id, 'orderId' => $orderId, 'openedById' => $userId,
                    'reason' => $reason, 'details' => trim($details),
                    'status' => $this->waitingStatus($requestedFrom),
                    'targetDeliverySubmissionId' => $targetDeliveryId,
                    'targetRevisionRequestId' => $targetRevision?->id,
                    'targetRevisionPurchaseId' => $purchase?->id,
                    'responseRequestedFrom' => $requestedFrom, 'responseRequestedAt' => $now,
                    'responseDeadlineAt' => $deadline, 'responseRequestSequence' => 1,
                    'reviewPausedAt' => $remaining === null ? null : $now,
                    'reviewRemainingSeconds' => $remaining, 'readyForReviewAt' => null,
                    'reviewStartedAt' => null, 'resolutionNote' => null, 'resolvedById' => null,
                    'resolvedAt' => null, 'createdAt' => $now, 'updatedAt' => $now,
                ]);
                if ($earning) {
                    $changed = DB::table('ProviderEarning')->where('id', $earning->id)
                        ->where('status', $earning->status)->update(['status' => 'FROZEN', 'updatedAt' => $now]);
                    if ($changed !== 1) {
                        throw $this->conflict('The affected earning changed before it could be frozen');
                    }
                    DB::table('DisputeAffectedEarning')->insert([
                        'id' => (string) Str::uuid(), 'disputeId' => $id,
                        'providerEarningId' => $earning->id, 'preFreezeStatus' => $earning->status,
                        'frozenAt' => $now, 'restoredAt' => null, 'createdAt' => $now,
                    ]);
                    $this->earningLedger($earning, $id, 'EARNING_FROZEN', 'frozen', $now);
                }
                $this->insertEvidence($id, $userId, $evidence, null, $now);
                $this->timeline($id, $userId, 'OPENED', 'Dispute opened and normal completion paused.', $now);
                $this->timeline($id, $userId, 'RESPONSE_REQUESTED', "{$requestedFrom} response requested within 48 hours.", $now);
                if ($evidence !== []) {
                    $this->timeline($id, $userId, 'EVIDENCE_ADDED', count($evidence).' evidence file(s) added.', $now);
                }
                $recipient = $order->clientId === $userId ? $order->providerId : $order->clientId;
                $this->notification($recipient, $orderId, 'ORDER_DISPUTE_OPENED', 'A dispute was opened',
                    "A dispute was opened for {$order->titleSnapshot}. Your response is requested within 48 hours.", $now);

                return $id;
            });
        } catch (Throwable $error) {
            $this->deleteEvidence($evidence);
            throw $error;
        }

        return ['data' => $this->responseById($disputeId),
            'message' => 'Dispute opened. Completion is paused and the affected earning is frozen where applicable.'];
    }

    /** @param list<UploadedFile> $files */
    public function submitResponse(string $userId, string $orderId, string $disputeId, string $details, array $files): array
    {
        $this->participantOrder($userId, $orderId);
        $this->reconcileExpiredResponse($disputeId);
        $evidence = $this->persistEvidence($files);
        $now = CarbonImmutable::now();
        try {
            DB::transaction(function () use ($userId, $orderId, $disputeId, $details, $evidence, $now): void {
                DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
                $dispute = DB::table('OrderDispute')->where('id', $disputeId)->where('orderId', $orderId)->first();
                if (! $dispute) {
                    throw $this->notFound('Dispute not found');
                }
                if (! in_array($dispute->status, ['WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER'], true)) {
                    throw $this->conflict('This dispute is not awaiting a response');
                }
                $order = DB::table('Order')->where('id', $orderId)->first();
                $expected = $dispute->responseRequestedFrom === 'CLIENT' ? $order->clientId : $order->providerId;
                if ($expected !== $userId) {
                    throw $this->notFound('Dispute not found');
                }
                if (! $dispute->responseRequestedFrom || ! $dispute->responseRequestedAt
                    || ! $dispute->responseDeadlineAt || (int) $dispute->responseRequestSequence < 1) {
                    throw $this->conflict('The response request is incomplete');
                }
                if (CarbonImmutable::parse($dispute->responseDeadlineAt)->lessThanOrEqualTo($now)) {
                    throw $this->conflict('The response deadline has passed; the dispute is ready for review');
                }
                $responseId = (string) Str::uuid();
                DB::table('DisputeResponse')->insert([
                    'id' => $responseId, 'disputeId' => $disputeId, 'responderId' => $userId,
                    'requestedFrom' => $dispute->responseRequestedFrom,
                    'requestSequence' => $dispute->responseRequestSequence, 'details' => trim($details),
                    'responseRequestedAt' => $dispute->responseRequestedAt,
                    'responseDeadlineAt' => $dispute->responseDeadlineAt, 'createdAt' => $now,
                ]);
                $this->insertEvidence($disputeId, $userId, $evidence, $responseId, $now);
                DB::table('OrderDispute')->where('id', $disputeId)->update([
                    'status' => 'READY_FOR_REVIEW', 'readyForReviewAt' => $now, 'updatedAt' => $now,
                ]);
                $this->timeline($disputeId, $userId, 'RESPONSE_SUBMITTED',
                    "Response submitted for request {$dispute->responseRequestSequence}.", $now);
                if ($evidence !== []) {
                    $this->timeline($disputeId, $userId, 'EVIDENCE_ADDED', count($evidence).' response evidence file(s) added.', $now);
                }
                $this->timeline($disputeId, $userId, 'READY_FOR_REVIEW', 'Requested response received.', $now);
                $recipient = $userId === $order->clientId ? $order->providerId : $order->clientId;
                $this->notification($recipient, $orderId, 'ORDER_DISPUTE_RESPONSE_RECEIVED', 'Dispute response received',
                    "A requested response was submitted for {$order->titleSnapshot}. The case is ready for admin review.", $now);
            });
        } catch (Throwable $error) {
            $this->deleteEvidence($evidence);
            throw $error;
        }

        return ['data' => $this->responseById($disputeId), 'message' => 'Response submitted. The dispute is ready for admin review.'];
    }

    /** @param list<UploadedFile> $files */
    public function appendEvidence(string $userId, string $orderId, string $disputeId, array $files): array
    {
        $this->participantOrder($userId, $orderId);
        if ($files === []) {
            throw $this->conflict('Attach at least one evidence file');
        }
        $evidence = $this->persistEvidence($files);
        $now = CarbonImmutable::now();
        try {
            DB::transaction(function () use ($userId, $orderId, $disputeId, $evidence, $now): void {
                DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
                $dispute = DB::table('OrderDispute')->where('id', $disputeId)->where('orderId', $orderId)->first();
                if (! $dispute || ! in_array($dispute->status, self::ACTIVE_STATUSES, true)) {
                    throw $this->notFound('Active dispute not found');
                }
                $this->insertEvidence($disputeId, $userId, $evidence, null, $now);
                $this->timeline($disputeId, $userId, 'EVIDENCE_ADDED', count($evidence).' evidence file(s) added.', $now);
            });
        } catch (Throwable $error) {
            $this->deleteEvidence($evidence);
            throw $error;
        }

        return ['data' => $this->responseById($disputeId), 'message' => 'Evidence added without replacing earlier evidence.'];
    }

    public function evidence(string $userId, string $orderId, string $disputeId, string $evidenceId): object
    {
        $this->participantOrder($userId, $orderId);
        $evidence = DB::table('DisputeEvidence')->join('OrderDispute', 'OrderDispute.id', '=', 'DisputeEvidence.disputeId')
            ->where('DisputeEvidence.id', $evidenceId)->where('DisputeEvidence.disputeId', $disputeId)
            ->where('OrderDispute.orderId', $orderId)->select('DisputeEvidence.*')->first();
        if (! $evidence) {
            throw $this->notFound('Evidence not found');
        }

        return $evidence;
    }

    public function adminEvidence(string $disputeId, string $evidenceId): object
    {
        $evidence = DB::table('DisputeEvidence')->where('id', $evidenceId)->where('disputeId', $disputeId)->first();
        if (! $evidence) {
            throw $this->notFound('Evidence not found');
        }

        return $evidence;
    }

    public function adminList(?string $status, ?string $cursor, int $limit): array
    {
        $this->reconcileExpiredBatch(100);
        $query = DB::table('OrderDispute')->when($status, fn ($query) => $query->where('status', $status));
        if ($cursor) {
            [$createdAt, $id] = $this->decodeCursor($cursor);
            $query->where(fn ($where) => $where->where('createdAt', '>', $createdAt)
                ->orWhere(fn ($tie) => $tie->where('createdAt', $createdAt)->where('id', '>', $id)));
        }
        $rows = $query
            ->orderBy('createdAt')->orderBy('id')->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit)->values();
        $last = $page->last();

        return ['data' => $page->map(fn (object $row): array => $this->response($row, true))->all(),
            'pagination' => ['hasMore' => $hasMore,
                'nextCursor' => $hasMore && $last ? $this->encodeCursor($last->createdAt, $last->id) : null]];
    }

    public function adminDetail(string $disputeId): array
    {
        $this->reconcileExpiredResponse($disputeId);

        return ['data' => $this->responseById($disputeId, true)];
    }

    public function requestResponse(string $adminId, string $disputeId, string $requestedFrom): array
    {
        $orderId = $this->disputeOrderId($disputeId);
        $now = CarbonImmutable::now();
        DB::transaction(function () use ($adminId, $disputeId, $orderId, $requestedFrom, $now): void {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $dispute = DB::table('OrderDispute')->where('id', $disputeId)->first();
            if (! $dispute || ! in_array($dispute->status, self::ACTIVE_STATUSES, true)) {
                throw $this->conflict('This dispute has already been resolved');
            }
            $order = DB::table('Order')->where('id', $orderId)->first();
            DB::table('OrderDispute')->where('id', $disputeId)->update([
                'status' => $this->waitingStatus($requestedFrom), 'responseRequestedFrom' => $requestedFrom,
                'responseRequestedAt' => $now, 'responseDeadlineAt' => $now->addHours(48),
                'responseRequestSequence' => (int) $dispute->responseRequestSequence + 1,
                'readyForReviewAt' => null, 'updatedAt' => $now,
            ]);
            $this->timeline($disputeId, $adminId, 'RESPONSE_REQUESTED', "{$requestedFrom} response requested within 48 hours.", $now);
            $recipient = $requestedFrom === 'CLIENT' ? $order->clientId : $order->providerId;
            $this->notification($recipient, $orderId, 'ORDER_DISPUTE_RESPONSE_REQUESTED', 'Your dispute response is requested',
                "Please respond within 48 hours for {$order->titleSnapshot}.", $now);
        });
        $result = $this->adminDetail($disputeId);
        $result['message'] = 'A new 48-hour response window has started.';

        return $result;
    }

    public function markReady(string $adminId, string $disputeId): array
    {
        return $this->transitionToReviewState($adminId, $disputeId, 'READY_FOR_REVIEW');
    }

    public function beginReview(string $adminId, string $disputeId): array
    {
        $this->reconcileExpiredResponse($disputeId);

        return $this->transitionToReviewState($adminId, $disputeId, 'UNDER_REVIEW');
    }

    public function resolve(string $adminId, string $disputeId, string $status, string $note): array
    {
        if (! in_array($status, self::FINAL_STATUSES, true)) {
            throw $this->conflict('Select a final dispute resolution');
        }
        $orderId = $this->disputeOrderId($disputeId);
        $resolvedAt = CarbonImmutable::now();
        $transitioned = DB::transaction(function () use ($adminId, $disputeId, $orderId, $status, $note, $resolvedAt): bool {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $dispute = DB::table('OrderDispute')->where('id', $disputeId)->first();
            if (! $dispute) {
                throw $this->notFound('Dispute not found');
            }
            if (! in_array($dispute->status, self::ACTIVE_STATUSES, true)) {
                if ($dispute->status === $status) {
                    return false;
                }
                throw $this->conflict('This dispute has already been resolved');
            }
            if ($status !== 'CLOSED' && $dispute->status !== 'UNDER_REVIEW') {
                throw $this->conflict('Begin admin review before recording a decision');
            }
            $order = DB::table('Order')->where('id', $orderId)->first();
            if (in_array($status, ['RESOLVED_PROVIDER', 'CLOSED'], true)) {
                $affected = DB::table('DisputeAffectedEarning')->where('disputeId', $disputeId)->get();
                foreach ($affected as $item) {
                    if ($item->restoredAt) {
                        continue;
                    }
                    $earning = DB::table('ProviderEarning')->where('id', $item->providerEarningId)->first();
                    if (! $earning || DB::table('ProviderEarning')->where('id', $item->providerEarningId)
                        ->where('status', 'FROZEN')->update(['status' => $item->preFreezeStatus, 'updatedAt' => $resolvedAt]) !== 1) {
                        throw $this->conflict('A frozen earning changed before restoration');
                    }
                    $this->earningLedger($earning, $disputeId, 'EARNING_UNFROZEN', 'unfrozen', $resolvedAt);
                    DB::table('DisputeAffectedEarning')->where('id', $item->id)->update(['restoredAt' => $resolvedAt]);
                }
                if ($dispute->reviewPausedAt && $dispute->reviewRemainingSeconds !== null
                    && $order->status === 'SUBMITTED' && $order->reviewDeliverySubmissionId === $dispute->targetDeliverySubmissionId) {
                    DB::table('Order')->where('id', $orderId)->update([
                        'reviewDeadlineAt' => $resolvedAt->addSeconds((int) $dispute->reviewRemainingSeconds), 'updatedAt' => $resolvedAt,
                    ]);
                }
            }
            DB::table('OrderDispute')->where('id', $disputeId)->update([
                'status' => $status, 'resolutionNote' => trim($note), 'resolvedById' => $adminId,
                'resolvedAt' => $resolvedAt, 'updatedAt' => $resolvedAt,
            ]);
            $this->timeline($disputeId, $adminId, $status, trim($note), $resolvedAt);
            foreach ([$order->clientId, $order->providerId] as $recipient) {
                $body = $status === 'RESOLVED_CLIENT'
                    ? trim($note).' The affected earning remains frozen; no refund has been issued yet.' : trim($note);
                $this->notification($recipient, $orderId, 'ORDER_DISPUTE_RESOLVED', 'Dispute review completed', $body, $resolvedAt);
            }

            return true;
        });
        $result = $this->adminDetail($disputeId);
        $result['message'] = $transitioned
            ? 'Dispute resolved and both parties notified.'
            : 'This resolution was already recorded; no duplicate action was taken.';

        return $result;
    }

    public function reconcileExpiredResponse(string $disputeId): bool
    {
        $row = DB::table('OrderDispute')->where('id', $disputeId)->first();
        if (! $row) {
            return false;
        }
        $now = CarbonImmutable::now();

        return DB::transaction(function () use ($row, $disputeId, $now): bool {
            DB::table('Order')->where('id', $row->orderId)->lockForUpdate()->first();
            $dispute = DB::table('OrderDispute')->where('id', $disputeId)->first();
            if (! $dispute || ! in_array($dispute->status, ['WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER'], true)
                || ! $dispute->responseDeadlineAt || CarbonImmutable::parse($dispute->responseDeadlineAt)->greaterThan($now)) {
                return false;
            }
            $changed = DB::table('OrderDispute')->where('id', $disputeId)
                ->whereIn('status', ['WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER'])
                ->where('responseDeadlineAt', '<=', $now)->update([
                    'status' => 'READY_FOR_REVIEW', 'readyForReviewAt' => $now, 'updatedAt' => $now,
                ]);
            if ($changed !== 1) {
                return false;
            }
            $this->timeline($disputeId, null, 'RESPONSE_DEADLINE_EXPIRED', 'The response deadline expired without deciding a winner.', $now);
            $this->timeline($disputeId, null, 'READY_FOR_REVIEW', 'The case is ready for admin review using available evidence.', $now);
            $order = DB::table('Order')->where('id', $row->orderId)->first();
            foreach ([$order->clientId, $order->providerId] as $recipient) {
                $this->notification($recipient, $row->orderId, 'ORDER_DISPUTE_READY_FOR_REVIEW', 'Dispute is ready for review',
                    "The response window for {$order->titleSnapshot} ended. No winner was selected automatically.", $now);
            }

            return true;
        });
    }

    public function reconcileExpiredResponses(int $limit = 25): int
    {
        $ids = DB::table('OrderDispute')->whereIn('status', ['WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER'])
            ->where('responseDeadlineAt', '<=', now())->orderBy('responseDeadlineAt')->orderBy('id')
            ->limit(min(max($limit, 1), 100))->pluck('id');

        return $ids->reduce(fn (int $count, string $id): int => $count + ($this->reconcileExpiredResponse($id) ? 1 : 0), 0);
    }

    private function transitionToReviewState(string $adminId, string $disputeId, string $target): array
    {
        $orderId = $this->disputeOrderId($disputeId);
        $now = CarbonImmutable::now();
        DB::transaction(function () use ($adminId, $disputeId, $orderId, $target, $now): void {
            DB::table('Order')->where('id', $orderId)->lockForUpdate()->first();
            $dispute = DB::table('OrderDispute')->where('id', $disputeId)->first();
            if (! $dispute || ! in_array($dispute->status, self::ACTIVE_STATUSES, true)) {
                throw $this->conflict('This dispute has already been resolved');
            }
            if ($target === 'READY_FOR_REVIEW') {
                if ($dispute->status === 'UNDER_REVIEW') {
                    return;
                }
                DB::table('OrderDispute')->where('id', $disputeId)->update([
                    'status' => $target, 'readyForReviewAt' => $now, 'updatedAt' => $now,
                ]);
                $this->timeline($disputeId, $adminId, 'READY_FOR_REVIEW', 'Administrator marked the case ready for review.', $now);
            } else {
                if (! in_array($dispute->status, ['READY_FOR_REVIEW', 'OPEN'], true)) {
                    throw $this->conflict('This dispute is not ready for review');
                }
                DB::table('OrderDispute')->where('id', $disputeId)->update([
                    'status' => $target, 'reviewStartedAt' => $now, 'updatedAt' => $now,
                ]);
                $this->timeline($disputeId, $adminId, 'REVIEW_STARTED', 'Administrator began evidence review.', $now);
            }
        });

        return $this->adminDetail($disputeId);
    }

    private function responseById(string $id, bool $admin = false): array
    {
        $row = DB::table('OrderDispute')->where('id', $id)->first();
        if (! $row) {
            throw $this->notFound('Dispute not found');
        }

        return $this->response($row, $admin);
    }

    private function response(object $row, bool $admin = false): array
    {
        $data = (array) $row;
        foreach (['createdAt', 'updatedAt', 'responseRequestedAt', 'responseDeadlineAt', 'reviewPausedAt', 'readyForReviewAt', 'reviewStartedAt', 'resolvedAt'] as $field) {
            $data[$field] = $this->date($row->{$field} ?? null);
        }
        $data['openedBy'] = $this->publicUser($row->openedById);
        $data['resolvedBy'] = $row->resolvedById ? $this->publicUser($row->resolvedById) : null;
        $data['targetDeliverySubmission'] = $row->targetDeliverySubmissionId
            ? $this->row('DeliverySubmission', $row->targetDeliverySubmissionId, ['id', 'version', 'submittedAt']) : null;
        $data['targetRevisionRequest'] = $row->targetRevisionRequestId
            ? $this->row('RevisionRequest', $row->targetRevisionRequestId, ['id', 'sequenceNumber', 'type', 'createdAt']) : null;
        $data['targetRevisionPurchase'] = $row->targetRevisionPurchaseId
            ? $this->row('OrderRevisionPurchase', $row->targetRevisionPurchaseId,
                ['id', 'providerSubtotalCentavos', 'currency', 'paymentStatus']) : null;
        $data['affectedEarnings'] = DB::table('DisputeAffectedEarning')->where('disputeId', $row->id)->orderBy('createdAt')->get()
            ->map(function (object $affected): array {
                $item = (array) $affected;
                $item['frozenAt'] = $this->date($affected->frozenAt);
                $item['restoredAt'] = $this->date($affected->restoredAt);
                $item['providerEarning'] = $this->row('ProviderEarning', $affected->providerEarningId,
                    ['id', 'sourceType', 'status', 'currency', 'grossServiceAmountCentavos']);

                return $item;
            })->values()->all();
        $data['evidence'] = DB::table('DisputeEvidence')->where('disputeId', $row->id)->orderBy('createdAt')->orderBy('id')
            ->get(['id', 'responseId', 'submittedById', 'originalName', 'mimeType', 'sizeBytes', 'checksum', 'createdAt'])
            ->map(fn (object $item): array => [...(array) $item, 'createdAt' => $this->date($item->createdAt)])->all();
        $data['responses'] = DB::table('DisputeResponse')->where('disputeId', $row->id)->orderBy('requestSequence')->orderBy('id')->get()
            ->map(fn (object $item): array => [...(array) $item, 'responder' => $this->publicUser($item->responderId),
                'createdAt' => $this->date($item->createdAt), 'responseRequestedAt' => $this->date($item->responseRequestedAt),
                'responseDeadlineAt' => $this->date($item->responseDeadlineAt)])->all();
        $data['timeline'] = DB::table('DisputeTimelineEvent')->where('disputeId', $row->id)->orderBy('createdAt')->orderBy('id')->get()
            ->map(fn (object $item): array => [...(array) $item, 'actor' => $item->actorId ? $this->publicUser($item->actorId) : null,
                'createdAt' => $this->date($item->createdAt)])->all();
        if ($admin) {
            $order = DB::table('Order')->where('id', $row->orderId)->first();
            $orderData = $order ? ['id' => $order->id, 'orderNumber' => $order->orderNumber,
                'titleSnapshot' => $order->titleSnapshot, 'requirements' => $order->requirements,
                'termsSnapshot' => $this->json($order->termsSnapshot), 'subtotalCentavos' => (int) $order->subtotalCentavos,
                'platformFeeCentavos' => (int) $order->platformFeeCentavos, 'totalCentavos' => (int) $order->totalCentavos,
                'currency' => $order->currency, 'status' => $order->status, 'completionSource' => $order->completionSource,
                'reviewStartedAt' => $this->date($order->reviewStartedAt), 'reviewDeadlineAt' => $this->date($order->reviewDeadlineAt),
                'client' => $this->publicUser($order->clientId), 'provider' => $this->publicUser($order->providerId)] : null;
            if ($order && $orderData) {
                $orderData['deliverySubmissions'] = DB::table('DeliverySubmission')->where('orderId', $order->id)
                    ->orderBy('version')->get()->map(function (object $submission): array {
                        $item = ['id' => $submission->id, 'version' => (int) $submission->version,
                            'note' => $submission->note, 'submittedAt' => $this->date($submission->submittedAt),
                            'revisionRequestId' => $submission->revisionRequestId];
                        $item['files'] = DB::table('OrderFile')->where('deliverySubmissionId', $submission->id)
                            ->orderBy('createdAt')->get(['id', 'originalName', 'mimeType', 'sizeBytes', 'checksum', 'createdAt'])
                            ->map(fn (object $file): array => [...(array) $file, 'createdAt' => $this->date($file->createdAt)])->all();
                        $item['fileAccesses'] = DB::table('DeliveryFileAccessAudit')->where('deliverySubmissionId', $submission->id)
                            ->orderBy('accessedAt')->get(['id', 'fileId', 'userId', 'accessType', 'accessedAt'])
                            ->map(fn (object $access): array => [...(array) $access, 'accessedAt' => $this->date($access->accessedAt)])->all();

                        return $item;
                    })->all();
                $orderData['revisions'] = DB::table('RevisionRequest')->where('orderId', $order->id)
                    ->orderBy('sequenceNumber')->get()->map(function (object $revision): array {
                        $item = ['id' => $revision->id, 'sequenceNumber' => (int) $revision->sequenceNumber,
                            'type' => $revision->type, 'instructions' => $revision->instructions, 'status' => $revision->status,
                            'sourceDeliverySubmissionId' => $revision->sourceDeliverySubmissionId,
                            'revisionDeadlineAt' => $this->date($revision->revisionDeadlineAt),
                            'createdAt' => $this->date($revision->createdAt)];
                        $purchase = DB::table('OrderRevisionPurchase')->where('revisionRequestId', $revision->id)->first();
                        $item['purchase'] = $purchase ? ['id' => $purchase->id,
                            'providerSubtotalCentavos' => (int) $purchase->providerSubtotalCentavos,
                            'platformFeeCentavos' => (int) $purchase->platformFeeCentavos,
                            'totalCentavos' => (int) $purchase->totalCentavos, 'currency' => $purchase->currency,
                            'paymentStatus' => $purchase->paymentStatus, 'activationStatus' => $purchase->activationStatus] : null;

                        return $item;
                    })->all();
            }
            $data['order'] = $orderData;
        }

        return $data;
    }

    /** @param list<UploadedFile> $files @return list<array{storagePath:string,originalName:string,mimeType:string,sizeBytes:int,checksum:string}> */
    private function persistEvidence(array $files): array
    {
        $stored = [];
        try {
            foreach ($files as $file) {
                $result = $this->storage->storeDisputeEvidence($file);
                $stored[] = ['storagePath' => $result['key'], 'originalName' => $file->getClientOriginalName(),
                    'mimeType' => (string) $file->getMimeType(), 'sizeBytes' => $file->getSize(), 'checksum' => $result['checksum']];
            }
        } catch (Throwable $error) {
            $this->deleteEvidence($stored);
            throw $error;
        }

        return $stored;
    }

    private function deleteEvidence(array $evidence): void
    {
        foreach ($evidence as $file) {
            $this->storage->deleteDisputeEvidence($file['storagePath']);
        }
    }

    private function insertEvidence(string $disputeId, string $userId, array $evidence, ?string $responseId, CarbonImmutable $now): void
    {
        if ($evidence === []) {
            return;
        }
        DB::table('DisputeEvidence')->insert(array_map(fn (array $file): array => [
            'id' => (string) Str::uuid(), 'disputeId' => $disputeId, 'responseId' => $responseId,
            'submittedById' => $userId, ...$file, 'createdAt' => $now,
        ], $evidence));
    }

    private function reconcileExpiredBatch(int $limit): void
    {
        $this->reconcileExpiredResponses($limit);
    }

    private function reconcileExpiredForOrder(string $orderId): void
    {
        DB::table('OrderDispute')->where('orderId', $orderId)
            ->whereIn('status', ['WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER'])
            ->where('responseDeadlineAt', '<=', now())->limit(5)->pluck('id')
            ->each(fn (string $id) => $this->reconcileExpiredResponse($id));
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

    private function disputeOrderId(string $disputeId): string
    {
        $orderId = DB::table('OrderDispute')->where('id', $disputeId)->value('orderId');
        if (! is_string($orderId)) {
            throw $this->notFound('Dispute not found');
        }

        return $orderId;
    }

    private function waitingStatus(string $party): string
    {
        return $party === 'CLIENT' ? 'WAITING_FOR_CLIENT' : 'WAITING_FOR_PROVIDER';
    }

    private function timeline(string $disputeId, ?string $actorId, string $type, string $details, CarbonImmutable $at): void
    {
        DB::table('DisputeTimelineEvent')->insert(['id' => (string) Str::uuid(), 'disputeId' => $disputeId,
            'actorId' => $actorId, 'type' => $type, 'details' => $details, 'createdAt' => $at]);
    }

    private function notification(string $recipientId, string $orderId, string $type, string $title, string $body, CarbonImmutable $at): void
    {
        DB::table('Notification')->insert(['id' => (string) Str::uuid(), 'recipientId' => $recipientId,
            'orderId' => $orderId, 'type' => $type, 'title' => $title, 'body' => $body, 'createdAt' => $at]);
    }

    private function earningLedger(object $earning, string $disputeId, string $type, string $suffix, CarbonImmutable $at): void
    {
        DB::table('ProviderEarningLedgerEntry')->insert([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earning->id, 'providerId' => $earning->providerId,
            'orderId' => $earning->orderId, 'sourcePaymentId' => null, 'sourceRevisionPurchaseId' => null,
            'type' => $type, 'amountCentavos' => 0, 'currency' => $earning->currency,
            'sourceKey' => "earning:{$earning->id}:dispute:{$disputeId}:{$suffix}", 'createdAt' => $at,
        ]);
    }

    private function publicUser(string $id): ?array
    {
        $user = DB::table('User')->where('id', $id)->first(['id', 'displayName']);

        return $user ? (array) $user : null;
    }

    private function row(string $table, string $id, array $fields): ?array
    {
        $row = DB::table($table)->where('id', $id)->first($fields);

        return $row ? (array) $row : null;
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

    private function encodeCursor(mixed $createdAt, string $id): string
    {
        $json = json_encode(['date' => CarbonImmutable::parse($createdAt)->toISOString(), 'id' => $id], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    private function decodeCursor(string $cursor): array
    {
        $decoded = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = $decoded === false ? null : json_decode($decoded, true);
        if (! is_array($value) || ! is_string($value['date'] ?? null) || ! is_string($value['id'] ?? null)) {
            throw $this->badRequest('Invalid dispute cursor');
        }
        try {
            return [CarbonImmutable::parse($value['date']), $value['id']];
        } catch (Throwable) {
            throw $this->badRequest('Invalid dispute cursor');
        }
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
