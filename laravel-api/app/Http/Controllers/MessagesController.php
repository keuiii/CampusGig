<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\MessageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessagesController extends Controller
{
    public function __construct(private readonly MessageService $messages) {}

    public function inbox(Request $request): JsonResponse
    {
        $input = $request->validate([
            'archived' => ['sometimes', 'in:true,false,1,0'], 'cursor' => ['sometimes', 'string'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $archived = filter_var($input['archived'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return response()->json($this->messages->inbox($this->user($request)->id,
            $archived, $input['cursor'] ?? null, (int) ($input['limit'] ?? 20)));
    }

    public function inquiry(Request $request): JsonResponse
    {
        $input = $request->validate(['providerId' => ['required', 'uuid']]);

        return response()->json($this->messages->startInquiry($this->user($request)->id, $input['providerId']));
    }

    public function conversationMessages(Request $request, string $conversationId): JsonResponse
    {
        $this->uuid($conversationId);
        [$before, $limit] = $this->page($request);

        return response()->json($this->messages->listConversation($this->user($request)->id, $conversationId, $before, $limit));
    }

    public function sendConversation(Request $request, string $conversationId): JsonResponse
    {
        $this->uuid($conversationId);
        $input = $request->validate(['body' => ['required', 'string', 'min:1', 'max:191']]);

        return response()->json($this->messages->sendConversation($this->user($request)->id, $conversationId, $input['body']));
    }

    public function preferences(Request $request, string $conversationId): JsonResponse
    {
        $this->uuid($conversationId);
        $input = $request->validate(['pinned' => ['sometimes', 'boolean'], 'archived' => ['sometimes', 'boolean']]);

        return response()->json($this->messages->updatePreferences($this->user($request)->id, $conversationId,
            array_key_exists('pinned', $input) ? (bool) $input['pinned'] : null,
            array_key_exists('archived', $input) ? (bool) $input['archived'] : null));
    }

    public function hide(Request $request, string $conversationId): JsonResponse
    {
        $this->uuid($conversationId);

        return response()->json($this->messages->hide($this->user($request)->id, $conversationId));
    }

    public function orderMessages(Request $request, string $orderId): JsonResponse
    {
        $this->uuid($orderId);
        [$before, $limit] = $this->page($request);

        return response()->json($this->messages->listOrder($this->user($request)->id, $orderId, $before, $limit));
    }

    public function sendOrder(Request $request, string $orderId): JsonResponse
    {
        $this->uuid($orderId);
        $input = $request->validate(['body' => ['required', 'string', 'min:1', 'max:191']]);

        return response()->json($this->messages->sendOrder($this->user($request)->id, $orderId, $input['body']));
    }

    public function attachments(Request $request, string $orderId): JsonResponse
    {
        $this->uuid($orderId);
        $input = $request->validate([
            'body' => ['sometimes', 'nullable', 'string', 'max:191'],
            'files' => ['required', 'array', 'min:1', 'max:3'],
            'files.*' => ['required', 'file', 'max:15360', 'mimetypes:image/jpeg,image/png,image/webp,application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ]);

        return response()->json($this->messages->sendAttachments($this->user($request)->id, $orderId,
            $input['body'] ?? null, $request->file('files', [])));
    }

    private function page(Request $request): array
    {
        $input = $request->validate(['before' => ['sometimes', 'uuid'], 'limit' => ['sometimes', 'integer', 'min:1', 'max:100']]);

        return [$input['before'] ?? null, (int) ($input['limit'] ?? 50)];
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }

    private function uuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid identifier');
    }
}
