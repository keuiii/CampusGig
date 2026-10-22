<?php

namespace App\Http\Controllers;

use App\Services\NotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationsController extends Controller
{
    public function __construct(private readonly NotificationService $notifications) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->notifications->list($this->userId($request)));
    }

    public function markAllRead(Request $request): JsonResponse
    {
        return response()->json($this->notifications->markAllRead($this->userId($request)));
    }

    public function markRead(Request $request, string $id): JsonResponse
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid notification id');

        return response()->json($this->notifications->markRead($this->userId($request), $id));
    }

    private function userId(Request $request): string
    {
        return (string) $request->attributes->get('auth.user')->id;
    }
}
