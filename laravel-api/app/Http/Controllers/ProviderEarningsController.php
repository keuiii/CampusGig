<?php

namespace App\Http\Controllers;

use App\Services\ProviderEarningsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProviderEarningsController extends Controller
{
    public function __construct(private readonly ProviderEarningsService $earnings) {}

    public function summary(Request $request): JsonResponse
    {
        return response()->json($this->earnings->summary($this->userId($request)));
    }

    public function index(Request $request): JsonResponse
    {
        $input = $request->validate(['cursor' => ['sometimes', 'string'], 'limit' => ['sometimes', 'integer', 'min:1', 'max:50']]);

        return response()->json($this->earnings->list($this->userId($request), $input['cursor'] ?? null, (int) ($input['limit'] ?? 20)));
    }

    private function userId(Request $request): string
    {
        return (string) $request->attributes->get('auth.user')->id;
    }
}
