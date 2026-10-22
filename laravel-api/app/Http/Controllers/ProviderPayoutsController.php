<?php

namespace App\Http\Controllers;

use App\Services\ProviderPayoutService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ProviderPayoutsController extends Controller
{
    public function __construct(private readonly ProviderPayoutService $payouts) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->payouts->providerList($this->userId($request)));
    }

    public function destinations(Request $request): JsonResponse
    {
        return response()->json($this->payouts->destinations($this->userId($request)));
    }

    public function createDestination(Request $request): JsonResponse
    {
        $input = $request->validate([
            'type' => ['required', Rule::in(['BANK_ACCOUNT', 'E_WALLET'])],
            'displayLabel' => ['required', 'string', 'min:2', 'max:80'],
            'accountIdentifier' => ['required', 'string', 'min:4', 'max:80'],
            'accountHolderName' => ['required', 'string', 'min:2', 'max:120'],
        ]);

        return response()->json($this->payouts->createDestination($this->userId($request), $input));
    }

    public function deactivate(Request $request, string $destinationId): JsonResponse
    {
        $this->requireUuid($destinationId);
        $request->validate(['confirmation' => ['required', Rule::in(['CONFIRM'])]]);

        return response()->json($this->payouts->deactivateDestination($this->userId($request), $destinationId));
    }

    public function requestPayout(Request $request): JsonResponse
    {
        $input = $request->validate([
            'destinationId' => ['required', 'uuid'], 'clientRequestId' => ['required', 'uuid'],
            'currency' => ['required', 'string', 'regex:/^[A-Z]{3}$/'],
        ]);

        return response()->json($this->payouts->request($this->userId($request), $input));
    }

    public function cancel(Request $request, string $payoutId): JsonResponse
    {
        $this->requireUuid($payoutId);
        $request->validate(['confirmation' => ['required', Rule::in(['CONFIRM'])]]);

        return response()->json($this->payouts->cancel($this->userId($request), $payoutId));
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
