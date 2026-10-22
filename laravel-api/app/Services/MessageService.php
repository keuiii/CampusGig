<?php

namespace App\Services;

use App\Services\Storage\PrivateMediaStorage;
use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class MessageService
{
    public function __construct(private readonly PrivateMediaStorage $storage) {}

    public function inbox(string $userId, bool $archived, ?string $cursor, int $limit): array
    {
        $decoded = $cursor ? $this->decodeCursor($cursor) : null;
        $snapshot = $decoded['snapshotAt'] ?? CarbonImmutable::now();
        $updatedExpression = 'COALESCE(MAX(messages.createdAt), conversations.createdAt)';
        $pinnedExpression = 'CASE WHEN participants.pinnedAt IS NOT NULL AND participants.pinnedAt <= ? THEN 1 ELSE 0 END';
        $query = DB::table('ConversationParticipant as participants')
            ->join('Conversation as conversations', 'conversations.id', '=', 'participants.conversationId')
            ->leftJoin('Message as messages', function ($join) use ($snapshot): void {
                $join->on('messages.conversationId', '=', 'conversations.id')
                    ->whereNull('messages.deletedAt')->where('messages.createdAt', '<=', $snapshot);
            })
            ->where('participants.userId', $userId)->whereNull('participants.hiddenAt')
            ->where('conversations.createdAt', '<=', $snapshot)
            ->when($archived, fn ($builder) => $builder->whereNotNull('participants.archivedAt'),
                fn ($builder) => $builder->whereNull('participants.archivedAt'))
            ->groupBy('conversations.id', 'conversations.kind', 'conversations.orderId', 'conversations.clientId',
                'conversations.providerId', 'conversations.createdAt', 'participants.pinnedAt', 'participants.lastReadAt')
            ->select(['conversations.id', 'conversations.kind', 'conversations.orderId', 'conversations.clientId',
                'conversations.providerId', 'conversations.createdAt'])
            ->selectRaw("{$pinnedExpression} as isPinned", [$snapshot])
            ->selectRaw("{$updatedExpression} as updatedAt")
            ->selectRaw('SUM(CASE WHEN messages.id IS NOT NULL AND messages.senderId <> ? AND (participants.lastReadAt IS NULL OR messages.createdAt > participants.lastReadAt) THEN 1 ELSE 0 END) as unreadCount', [$userId])
            ->havingRaw('(conversations.kind = ? OR COUNT(messages.id) > 0)', ['ORDER']);
        if ($decoded) {
            if ($decoded['pinned']) {
                $query->havingRaw('(isPinned = 0 OR (isPinned = 1 AND (updatedAt < ? OR (updatedAt = ? AND conversations.id < ?))))',
                    [$decoded['updatedAt'], $decoded['updatedAt'], $decoded['id']]);
            } else {
                $query->havingRaw('isPinned = 0 AND (updatedAt < ? OR (updatedAt = ? AND conversations.id < ?))',
                    [$decoded['updatedAt'], $decoded['updatedAt'], $decoded['id']]);
            }
        }
        $ranks = $query->orderByDesc('isPinned')->orderByDesc('updatedAt')->orderByDesc('conversations.id')
            ->limit($limit + 1)->get();
        $hasMore = $ranks->count() > $limit;
        $page = $ranks->take($limit)->values();
        $last = $page->last();
        $totalUnread = DB::table('Message as messages')
            ->join('ConversationParticipant as participants', 'participants.conversationId', '=', 'messages.conversationId')
            ->where('participants.userId', $userId)->whereNull('participants.hiddenAt')
            ->when($archived, fn ($builder) => $builder->whereNotNull('participants.archivedAt'),
                fn ($builder) => $builder->whereNull('participants.archivedAt'))
            ->whereNull('messages.deletedAt')->where('messages.createdAt', '<=', $snapshot)
            ->where('messages.senderId', '<>', $userId)
            ->where(fn ($where) => $where->whereNull('participants.lastReadAt')
                ->orWhereColumn('messages.createdAt', '>', 'participants.lastReadAt'))->count();

        return ['data' => $page->map(fn (object $rank): array => $this->conversationResponse($rank, $userId, $archived))->all(),
            'unreadCount' => $totalUnread,
            'pagination' => ['hasMore' => $hasMore,
                'nextCursor' => $hasMore && $last ? $this->encodeCursor((bool) $last->isPinned, $last->updatedAt, $last->id, $snapshot) : null]];
    }

    public function startInquiry(string $clientId, string $providerId): array
    {
        if ($clientId === $providerId) {
            throw $this->badRequest('You cannot message your own provider profile');
        }
        $provider = DB::table('User as users')->join('ProviderProfile as profiles', 'profiles.userId', '=', 'users.id')
            ->join('StudentProfile as students', 'students.userId', '=', 'users.id')
            ->join('School as schools', 'schools.id', '=', 'students.schoolId')
            ->where('users.id', $providerId)->where('users.status', 'ACTIVE')->where('schools.status', 'ACTIVE')
            ->whereExists(fn ($query) => $query->selectRaw('1')->from('UserRoleAssignment as roles')
                ->whereColumn('roles.userId', 'users.id')->where('roles.role', 'PROVIDER'))
            ->select('users.id', 'users.displayName', 'users.avatarPath', 'users.updatedAt')->first();
        if (! $provider) {
            throw $this->notFound('Provider profile not found');
        }
        $conversation = DB::transaction(function () use ($clientId, $providerId): object {
            $existing = DB::table('Conversation')->where('clientId', $clientId)->where('providerId', $providerId)->first();
            if (! $existing) {
                $id = (string) Str::uuid();
                DB::table('Conversation')->insert(['id' => $id, 'kind' => 'INQUIRY', 'orderId' => null,
                    'clientId' => $clientId, 'providerId' => $providerId, 'createdAt' => now()]);
                foreach ([$clientId, $providerId] as $userId) {
                    DB::table('ConversationParticipant')->insert(['conversationId' => $id, 'userId' => $userId]);
                }
                $existing = DB::table('Conversation')->where('id', $id)->first();
            }
            DB::table('ConversationParticipant')->where('conversationId', $existing->id)->where('userId', $clientId)
                ->update(['hiddenAt' => null, 'archivedAt' => null]);

            return $existing;
        });

        return ['data' => ['id' => $conversation->id, 'kind' => 'INQUIRY', 'subject' => 'Provider inquiry',
            'contextLabel' => 'PRE-ORDER INQUIRY', 'unreadCount' => 0, 'updatedAt' => $this->date($conversation->createdAt),
            'isPinned' => false, 'isArchived' => false, 'participant' => $this->participant($provider),
            'latestMessage' => null, 'order' => null], 'message' => 'Provider conversation ready'];
    }

    public function listOrder(string $userId, string $orderId, ?string $before, int $limit): array
    {
        return $this->listMessages($userId, $this->orderConversation($userId, $orderId), $before, $limit);
    }

    public function listConversation(string $userId, string $conversationId, ?string $before, int $limit): array
    {
        return $this->listMessages($userId, $this->conversation($userId, $conversationId), $before, $limit);
    }

    public function sendOrder(string $userId, string $orderId, string $body): array
    {
        return $this->send($userId, $this->orderConversation($userId, $orderId), $body);
    }

    public function sendConversation(string $userId, string $conversationId, string $body): array
    {
        return $this->send($userId, $this->conversation($userId, $conversationId), $body);
    }

    /** @param list<UploadedFile> $files */
    public function sendAttachments(string $userId, string $orderId, ?string $body, array $files): array
    {
        if ($files === []) {
            throw $this->badRequest('Choose at least one attachment');
        }
        $conversation = $this->orderConversation($userId, $orderId);
        $stored = [];
        try {
            foreach ($files as $file) {
                $result = $this->storage->storeOrderFile($file);
                $stored[] = ['key' => $result['key'], 'checksum' => $result['checksum'], 'file' => $file];
            }
            $messageId = DB::transaction(function () use ($userId, $orderId, $conversation, $body, $stored): string {
                $id = (string) Str::uuid();
                $at = now();
                DB::table('Message')->insert(['id' => $id, 'conversationId' => $conversation->id,
                    'senderId' => $userId, 'body' => filled(trim((string) $body)) ? trim((string) $body) : null,
                    'messageType' => 'FILE', 'createdAt' => $at]);
                foreach ($stored as $item) {
                    $file = $item['file'];
                    $fileId = (string) Str::uuid();
                    DB::table('OrderFile')->insert(['id' => $fileId, 'orderId' => $orderId, 'deliverySubmissionId' => null,
                        'uploadedBy' => $userId, 'purpose' => 'MESSAGE_ATTACHMENT', 'storagePath' => $item['key'],
                        'originalName' => $file->getClientOriginalName(), 'mimeType' => (string) $file->getMimeType(),
                        'sizeBytes' => $file->getSize(), 'checksum' => $item['checksum'], 'createdAt' => $at]);
                    DB::table('MessageAttachment')->insert(['messageId' => $id, 'orderFileId' => $fileId]);
                }
                $this->afterSend($conversation, $userId, $id, $at,
                    count($stored) === 1 ? $stored[0]['file']->getClientOriginalName() : count($stored).' files');

                return $id;
            });
        } catch (Throwable $error) {
            foreach ($stored as $item) {
                $this->storage->deleteOrderFile($item['key']);
            }
            throw $error;
        }

        return ['data' => $this->messageResponse(DB::table('Message')->where('id', $messageId)->first(), $userId)];
    }

    public function updatePreferences(string $userId, string $conversationId, ?bool $pinned, ?bool $archived): array
    {
        $this->conversation($userId, $conversationId);
        if ($pinned === null && $archived === null) {
            throw $this->badRequest('Choose a conversation preference to update');
        }
        $values = ['hiddenAt' => null];
        if ($archived !== null) {
            $values['archivedAt'] = $archived ? now() : null;
        }
        if ($archived === true) {
            $values['pinnedAt'] = null;
        } elseif ($pinned !== null) {
            $values['pinnedAt'] = $pinned ? now() : null;
        }
        DB::table('ConversationParticipant')->where('conversationId', $conversationId)->where('userId', $userId)->update($values);
        $participant = DB::table('ConversationParticipant')->where('conversationId', $conversationId)->where('userId', $userId)->first();

        return ['data' => ['isPinned' => (bool) $participant->pinnedAt, 'isArchived' => (bool) $participant->archivedAt]];
    }

    public function hide(string $userId, string $conversationId): array
    {
        $this->conversation($userId, $conversationId);
        DB::table('ConversationParticipant')->where('conversationId', $conversationId)->where('userId', $userId)
            ->update(['hiddenAt' => now(), 'pinnedAt' => null, 'archivedAt' => null]);

        return ['message' => 'Conversation removed from Messages'];
    }

    private function listMessages(string $userId, object $conversation, ?string $before, int $limit): array
    {
        $query = DB::table('Message')->where('conversationId', $conversation->id)->whereNull('deletedAt');
        if ($before) {
            $cursor = DB::table('Message')->where('id', $before)->where('conversationId', $conversation->id)->first();
            if (! $cursor) {
                throw $this->badRequest('Invalid message cursor');
            }
            $query->where(fn ($where) => $where->where('createdAt', '<', $cursor->createdAt)
                ->orWhere(fn ($tie) => $tie->where('createdAt', $cursor->createdAt)->where('id', '<', $cursor->id)));
        }
        $messages = $query->orderByDesc('createdAt')->orderByDesc('id')->limit($limit)->get();
        $readAt = now();
        DB::transaction(function () use ($conversation, $userId, $messages, $readAt): void {
            DB::table('ConversationParticipant')->where('conversationId', $conversation->id)->where('userId', $userId)
                ->update(['lastReadAt' => $readAt, 'lastReadMessageId' => $messages->first()?->id, 'hiddenAt' => null]);
            DB::table('Notification')->where('recipientId', $userId)->where('type', 'NEW_MESSAGE')->whereNull('readAt')
                ->where(fn ($query) => $query->where('conversationId', $conversation->id)
                    ->when($conversation->orderId, fn ($nested, $orderId) => $nested->orWhere('orderId', $orderId)))
                ->update(['readAt' => $readAt]);
        });

        return ['data' => $messages->reverse()->values()->map(fn (object $message): array => $this->messageResponse($message, $userId))->all(),
            'page' => ['nextCursor' => $messages->count() === $limit ? $messages->last()?->id : null, 'limit' => $limit]];
    }

    private function send(string $userId, object $conversation, string $body): array
    {
        $id = DB::transaction(function () use ($userId, $conversation, $body): string {
            $id = (string) Str::uuid();
            $at = now();
            DB::table('Message')->insert(['id' => $id, 'conversationId' => $conversation->id,
                'senderId' => $userId, 'body' => trim($body), 'messageType' => 'TEXT', 'createdAt' => $at]);
            $this->afterSend($conversation, $userId, $id, $at, null);

            return $id;
        });

        return ['data' => $this->messageResponse(DB::table('Message')->where('id', $id)->first(), $userId)];
    }

    private function afterSend(object $conversation, string $userId, string $messageId, mixed $at, ?string $attachmentLabel): void
    {
        $recipientId = $this->recipientId($conversation, $userId);
        DB::table('ConversationParticipant')->where('conversationId', $conversation->id)->where('userId', $userId)
            ->update(['lastReadAt' => $at, 'lastReadMessageId' => $messageId, 'hiddenAt' => null, 'archivedAt' => null]);
        DB::table('ConversationParticipant')->where('conversationId', $conversation->id)->where('userId', $recipientId)
            ->update(['hiddenAt' => null, 'archivedAt' => null]);
        $sender = DB::table('User')->where('id', $userId)->first();
        $order = $conversation->orderId ? DB::table('Order')->where('id', $conversation->orderId)->first() : null;
        $body = $attachmentLabel
            ? "{$sender->displayName} attached {$attachmentLabel} to {$order->titleSnapshot}."
            : ($order ? "{$sender->displayName} sent a message about {$order->titleSnapshot}."
                : "{$sender->displayName} sent a pre-order message.");
        DB::table('Notification')->insert(['id' => (string) Str::uuid(), 'orderId' => $conversation->orderId,
            'conversationId' => $conversation->id, 'recipientId' => $recipientId, 'type' => 'NEW_MESSAGE',
            'title' => $attachmentLabel ? 'New order attachment' : ($order ? 'New order message' : 'New provider inquiry'),
            'body' => $body, 'createdAt' => $at]);
    }

    private function conversationResponse(object $rank, string $userId, bool $archived): array
    {
        $conversation = DB::table('Conversation')->where('id', $rank->id)->first();
        $order = $conversation->orderId ? DB::table('Order')->where('id', $conversation->orderId)->first() : null;
        $otherId = $order ? ($order->clientId === $userId ? $order->providerId : $order->clientId)
            : ($conversation->clientId === $userId ? $conversation->providerId : $conversation->clientId);
        $other = $otherId ? DB::table('User')->where('id', $otherId)->first() : null;
        if (! $other) {
            throw $this->notFound('Conversation participant not found');
        }
        $latest = DB::table('Message')->where('conversationId', $rank->id)->whereNull('deletedAt')
            ->orderByDesc('createdAt')->orderByDesc('id')->first();

        return ['id' => $rank->id, 'kind' => $conversation->kind,
            'subject' => $order?->titleSnapshot ?? 'Provider inquiry',
            'contextLabel' => $order?->orderNumber ?? 'PRE-ORDER INQUIRY',
            'unreadCount' => (int) $rank->unreadCount, 'updatedAt' => $this->date($rank->updatedAt),
            'isPinned' => (bool) $rank->isPinned, 'isArchived' => $archived,
            'participant' => $this->participant($other),
            'latestMessage' => $latest ? $this->messageResponse($latest, $userId) : null,
            'order' => $order ? ['id' => $order->id, 'orderNumber' => $order->orderNumber,
                'title' => $order->titleSnapshot, 'status' => $order->status, 'pricingModel' => $order->pricingModel,
                'requirements' => $order->requirements, 'totalCentavos' => (int) $order->totalCentavos,
                'currency' => $order->currency, 'dueAt' => $this->date($order->dueAt),
                'deliveryOption' => $order->deliveryOption, 'deliveryDurationMinutes' => $order->deliveryDurationMinutes,
                'createdAt' => $this->date($order->createdAt), 'provider' => $this->publicUser($order->providerId),
                'package' => $order->servicePackageId ? $this->package($order->servicePackageId) : null] : null];
    }

    private function messageResponse(object $message, string $userId): array
    {
        $sender = DB::table('User')->where('id', $message->senderId)->first();
        $attachments = DB::table('MessageAttachment as links')->join('OrderFile as files', 'files.id', '=', 'links.orderFileId')
            ->where('links.messageId', $message->id)->orderBy('files.createdAt')
            ->get(['files.id', 'files.originalName', 'files.mimeType', 'files.sizeBytes', 'files.createdAt'])
            ->map(fn (object $file): array => [...(array) $file, 'sizeBytes' => (int) $file->sizeBytes,
                'createdAt' => $this->date($file->createdAt)])->all();

        return ['id' => $message->id, 'body' => $message->body, 'messageType' => $message->messageType,
            'createdAt' => $this->date($message->createdAt), 'isMine' => $message->senderId === $userId,
            'attachments' => $attachments, 'sender' => $this->participant($sender)];
    }

    private function orderConversation(string $userId, string $orderId): object
    {
        $conversation = DB::table('Conversation as conversations')
            ->join('ConversationParticipant as participants', 'participants.conversationId', '=', 'conversations.id')
            ->where('conversations.orderId', $orderId)->where('participants.userId', $userId)
            ->select('conversations.*')->first();
        if (! $conversation) {
            throw $this->notFound('Order conversation not found');
        }

        return $conversation;
    }

    private function conversation(string $userId, string $conversationId): object
    {
        $conversation = DB::table('Conversation as conversations')
            ->join('ConversationParticipant as participants', 'participants.conversationId', '=', 'conversations.id')
            ->where('conversations.id', $conversationId)->where('participants.userId', $userId)
            ->select('conversations.*')->first();
        if (! $conversation) {
            throw $this->notFound('Conversation not found');
        }

        return $conversation;
    }

    private function recipientId(object $conversation, string $userId): string
    {
        if ($conversation->orderId) {
            $order = DB::table('Order')->where('id', $conversation->orderId)->first();

            return $order->clientId === $userId ? $order->providerId : $order->clientId;
        }
        $recipient = $conversation->clientId === $userId ? $conversation->providerId : $conversation->clientId;
        if (! $recipient) {
            throw $this->notFound('Conversation participant not found');
        }

        return $recipient;
    }

    private function participant(object $user): array
    {
        return ['id' => $user->id, 'displayName' => $user->displayName, 'hasAvatar' => (bool) $user->avatarPath,
            'avatarVersion' => CarbonImmutable::parse($user->updatedAt)->getTimestampMs()];
    }

    private function publicUser(string $id): ?array
    {
        $user = DB::table('User')->where('id', $id)->first(['id', 'displayName']);

        return $user ? (array) $user : null;
    }

    private function package(string $id): ?array
    {
        $package = DB::table('ServicePackage')->where('id', $id)->first();

        return $package ? ['id' => $package->id, 'tier' => $package->tier, 'name' => $package->name,
            'description' => $package->description, 'priceCentavos' => (int) $package->priceCentavos,
            'deliveryDays' => (int) $package->deliveryDays, 'revisionLimit' => (int) $package->revisionLimit] : null;
    }

    private function encodeCursor(bool $pinned, mixed $updatedAt, string $id, CarbonImmutable $snapshot): string
    {
        $json = json_encode(['pinned' => $pinned, 'updatedAt' => CarbonImmutable::parse($updatedAt)->toISOString(),
            'id' => $id, 'snapshotAt' => $snapshot->toISOString()], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    private function decodeCursor(string $cursor): array
    {
        $decoded = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = $decoded === false ? null : json_decode($decoded, true);
        if (! is_array($value) || ! is_bool($value['pinned'] ?? null) || ! is_string($value['updatedAt'] ?? null)
            || ! is_string($value['id'] ?? null) || ! is_string($value['snapshotAt'] ?? null)) {
            throw $this->badRequest('Invalid conversation cursor');
        }
        try {
            return ['pinned' => $value['pinned'], 'updatedAt' => CarbonImmutable::parse($value['updatedAt']),
                'id' => $value['id'], 'snapshotAt' => CarbonImmutable::parse($value['snapshotAt'])];
        } catch (Throwable) {
            throw $this->badRequest('Invalid conversation cursor');
        }
    }

    private function date(mixed $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->toISOString() : null;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return $this->error(400, 'Bad Request', $message);
    }

    private function notFound(string $message): HttpResponseException
    {
        return $this->error(404, 'Not Found', $message);
    }

    private function error(int $status, string $error, string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $error, 'statusCode' => $status], $status));
    }
}
