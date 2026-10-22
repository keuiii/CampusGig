<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Payments\PaymentService;
use App\Services\Payments\PaymongoClient;
use App\Services\Payments\RefundService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class PaymentsController extends Controller
{
    public function __construct(
        private readonly PaymentService $payments,
        private readonly PaymongoClient $paymongo,
        private readonly RefundService $refunds,
    ) {}

    public function index(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);

        return response()->json($this->payments->forOrder($this->user($request)->id, $orderId));
    }

    public function checkout(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);
        $input = $request->validate(['returnTarget' => ['sometimes', Rule::in(['WEB', 'MOBILE'])]]);

        return response()->json($this->payments->createCheckout(
            $this->user($request)->id,
            $orderId,
            $input['returnTarget'] ?? 'WEB',
        ));
    }

    public function refundEligibility(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);

        return response()->json($this->refunds->eligibility($this->user($request)->id, $orderId));
    }

    public function requestRefund(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);
        $input = $request->validate([
            'reason' => ['required', Rule::in(['PAID_NOT_STARTED', 'MISSED_RUSH_DEADLINE'])],
        ]);

        return response()->json($this->refunds->request(
            $this->user($request)->id,
            $orderId,
            $input['reason'],
        ));
    }

    public function revisionQuote(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);

        return response()->json($this->payments->quoteExtraRevision($this->user($request)->id, $orderId));
    }

    public function revisionCheckout(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);
        $input = $request->validate([
            'instructions' => ['required', 'string', 'min:10', 'max:2000'],
            'returnTarget' => ['sometimes', Rule::in(['WEB', 'MOBILE'])],
        ]);

        return response()->json($this->payments->createExtraRevisionCheckout(
            $this->user($request)->id,
            $orderId,
            $input['instructions'],
            $input['returnTarget'] ?? 'WEB',
        ));
    }

    public function webhook(Request $request): JsonResponse
    {
        $raw = $request->getContent();
        $this->paymongo->verifyWebhook($raw, $request->header('paymongo-signature'));
        $payload = json_decode($raw, true);
        abort_unless(is_array($payload), 400, 'Invalid PayMongo webhook payload');

        return response()->json($this->payments->processWebhook($payload));
    }

    public function mobileReturn(Request $request): Response
    {
        $input = $request->validate([
            'payment' => ['required', Rule::in(['success', 'cancelled'])],
            'orderId' => ['required', 'uuid'],
            'revisionPurchaseId' => ['sometimes', 'uuid'],
        ]);
        $query = http_build_query(array_filter([
            'payment' => $input['payment'], 'orderId' => $input['orderId'],
            'revisionPurchaseId' => $input['revisionPurchaseId'] ?? null,
        ]));
        $deepLink = 'campusgig://payment-return?'.$query;
        $intent = 'intent://payment-return?'.$query.'#Intent;scheme=campusgig;package=com.campusgig.app;end';
        $heading = $input['payment'] === 'success' ? 'Payment submitted' : 'Checkout cancelled';
        $safeLink = htmlspecialchars($deepLink, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeIntent = json_encode($intent, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR);
        $html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Return to CampusGig</title></head><body><main><h1>{$heading}</h1><p>Return to CampusGig to refresh your order securely.</p><a href=\"{$safeLink}\">Return to CampusGig</a></main><script>window.location.replace({$safeIntent});</script></body></html>";

        return response($html, 200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Content-Security-Policy' => "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        ]);
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid order id');
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }
}
