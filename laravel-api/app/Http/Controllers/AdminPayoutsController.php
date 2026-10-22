<?php

namespace App\Http\Controllers;

use App\Services\ProviderPayoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminPayoutsController extends Controller
{
    public function __construct(private readonly ProviderPayoutService $payouts) {}

    public function index(Request $request): JsonResponse
    {
        $input = $request->validate(['limit' => ['sometimes', 'integer', 'min:1', 'max:100']]);

        return response()->json($this->payouts->adminList((int) ($input['limit'] ?? 25)));
    }

    public function destinations(): JsonResponse
    {
        return response()->json($this->payouts->adminDestinations());
    }

    public function reviewDestination(Request $request, string $destinationId): JsonResponse
    {
        $this->requireUuid($destinationId);
        $input = $request->validate(['note' => ['required', 'string', 'min:20', 'max:1000']]);

        return response()->json($this->payouts->reviewDestination($this->userId($request), $destinationId, $input['note']));
    }

    public function sensitiveDestinationDetails(Request $request, string $destinationId): JsonResponse
    {
        $this->requireUuid($destinationId);

        return response()->json($this->payouts->sensitiveDestinationDetails($this->userId($request), $destinationId))
            ->header('Cache-Control', 'private, no-store');
    }

    public function detail(string $payoutId): JsonResponse
    {
        $this->requireUuid($payoutId);

        return response()->json(['data' => $this->payouts->adminDetail($payoutId)]);
    }

    public function approve(Request $request, string $payoutId): JsonResponse
    {
        return $this->decision($request, $payoutId, 'approve');
    }

    public function reject(Request $request, string $payoutId): JsonResponse
    {
        return $this->decision($request, $payoutId, 'reject');
    }

    public function beginManual(Request $request, string $payoutId): JsonResponse
    {
        $this->requireUuid($payoutId);
        $input = $request->validate([
            'note' => ['required', 'string', 'min:20', 'max:1000'],
            'confirmation' => ['required', Rule::in(['MANUAL SETTLEMENT'])],
        ]);

        return response()->json($this->payouts->beginManual($this->userId($request), $payoutId, $input['note']));
    }

    public function settleManual(Request $request, string $payoutId): JsonResponse
    {
        $this->requireUuid($payoutId);
        $input = $request->validate([
            'amountCentavos' => ['required', 'integer', 'min:1'],
            'manualReference' => ['required', 'string', 'min:4', 'max:120'],
            'settledAt' => ['required', 'date'], 'note' => ['required', 'string', 'min:20', 'max:1000'],
            'confirmation' => ['required', Rule::in(['MANUAL SETTLEMENT CONFIRMED'])],
        ]);

        return response()->json($this->payouts->settleManual($this->userId($request), $payoutId, $input));
    }

    private function decision(Request $request, string $payoutId, string $decision): JsonResponse
    {
        $this->requireUuid($payoutId);
        $input = $request->validate(['note' => ['required', 'string', 'min:20', 'max:1000']]);
        $result = $decision === 'approve'
            ? $this->payouts->approve($this->userId($request), $payoutId, $input['note'])
            : $this->payouts->reject($this->userId($request), $payoutId, $input['note']);

        return response()->json($result);
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid payout id');
    }

    private function userId(Request $request): string
    {
        return (string) $request->attributes->get('auth.user')->id;
    }
}
