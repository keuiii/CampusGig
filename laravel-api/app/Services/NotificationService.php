<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

class NotificationService
{
    public function list(string $userId): array
    {
        $data = DB::table('Notification')->where('recipientId', $userId)
            ->orderByDesc('createdAt')->limit(30)->get()->map(fn (object $row): array => $this->response($row))->all();

        return [
            'data' => $data,
            'unreadCount' => DB::table('Notification')->where('recipientId', $userId)->whereNull('readAt')->count(),
        ];
    }

    public function markRead(string $userId, string $id): array
    {
        $notification = DB::table('Notification')->where('id', $id)->where('recipientId', $userId)->first();
        if (! $notification) {
            throw new HttpResponseException(response()->json([
                'message' => 'Notification not found', 'error' => 'Not Found', 'statusCode' => 404,
            ], 404));
        }
        if (! $notification->readAt) {
            DB::table('Notification')->where('id', $id)->whereNull('readAt')->update(['readAt' => now()]);
        }

        return ['data' => $this->response(DB::table('Notification')->where('id', $id)->first())];
    }

    public function markAllRead(string $userId): array
    {
        $updated = DB::table('Notification')->where('recipientId', $userId)->whereNull('readAt')->update(['readAt' => now()]);

        return [
            'updated' => $updated,
            'message' => $updated === 0
                ? 'All notifications were already read.'
                : $updated.' notification'.($updated === 1 ? '' : 's').' marked as read.',
        ];
    }

    private function response(object $row): array
    {
        return [
            'id' => $row->id, 'recipientId' => $row->recipientId,
            'orderId' => $row->orderId, 'conversationId' => $row->conversationId,
            'type' => $row->type, 'title' => $row->title, 'body' => $row->body,
            'readAt' => $row->readAt ? CarbonImmutable::parse($row->readAt)->toISOString() : null,
            'createdAt' => CarbonImmutable::parse($row->createdAt)->toISOString(),
        ];
    }
}
