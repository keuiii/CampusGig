<?php

namespace App\Http\Controllers;

use App\Services\PublicProviderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PublicProviderController extends Controller
{
    public function __construct(private readonly PublicProviderService $providers) {}

    public function profile(string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->providers->profile($id))->header('Cache-Control', 'no-store');
    }

    public function reviews(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate([
            'page' => ['sometimes', 'integer', 'min:1'],
            'pageSize' => ['sometimes', 'integer', 'min:1', 'max:12'],
        ]);

        return response()->json($this->providers->reviews(
            $id,
            (int) ($input['page'] ?? 1),
            (int) ($input['pageSize'] ?? 5),
        ))->header('Cache-Control', 'no-store');
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid provider id');
    }
}
