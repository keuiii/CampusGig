<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SupportService
{
    public function create(string $userId, array $input): array
    {
        $recent = DB::table('SupportTicket')->where('userId', $userId)
            ->where('createdAt', '>=', now()->subHour())->count();
        if ($recent >= 5) {
            throw new HttpResponseException(response()->json([
                'message' => 'Too many support requests. Please wait before submitting another.',
                'error' => 'Too Many Requests', 'statusCode' => 429,
            ], 429));
        }
        $id = (string) Str::uuid();
        $now = now();
        DB::table('SupportTicket')->insert([
            'id' => $id, 'userId' => $userId, 'category' => $input['category'],
            'subject' => trim($input['subject']), 'message' => trim($input['message']),
            'source' => $input['source'], 'status' => 'OPEN', 'createdAt' => $now, 'updatedAt' => $now,
        ]);
        $ticket = DB::table('SupportTicket')->where('id', $id)->first();

        return [
            'data' => $this->summary($ticket, false),
            'reference' => 'CG-SUPPORT-'.strtoupper(substr(str_replace('-', '', $id), 0, 8)),
            'message' => 'Your support request has been submitted.',
        ];
    }

    public function mine(string $userId): array
    {
        return ['data' => DB::table('SupportTicket')->where('userId', $userId)
            ->orderByDesc('createdAt')->limit(10)->get()
            ->map(fn (object $ticket): array => $this->summary($ticket, true))->all()];
    }

    private function summary(object $ticket, bool $includeResolved): array
    {
        $data = [
            'id' => $ticket->id, 'category' => $ticket->category, 'status' => $ticket->status,
            'subject' => $ticket->subject, 'createdAt' => CarbonImmutable::parse($ticket->createdAt)->toISOString(),
        ];
        if ($includeResolved) {
            $data['resolvedAt'] = $ticket->resolvedAt ? CarbonImmutable::parse($ticket->resolvedAt)->toISOString() : null;
        }

        return $data;
    }
}
