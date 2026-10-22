<?php

namespace App\Services\Payments;

use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Http;

class PaymongoClient
{
    public function createCheckout(array $input): array
    {
        $target = $input['returnTarget'] ?? 'WEB';
        $origin = $target === 'MOBILE'
            ? (string) config('campusgig.paymongo.mobile_return_origin')
            : (string) config('campusgig.web_origin');
        $success = $this->returnUrl($target === 'MOBILE' ? 'mobile_success_url' : 'success_url', $origin, 'success', $input['orderId'], $target, $input['revisionPurchaseId'] ?? null);
        $cancel = $this->returnUrl($target === 'MOBILE' ? 'mobile_cancel_url' : 'cancel_url', $origin, 'cancelled', $input['orderId'], $target, $input['revisionPurchaseId'] ?? null);
        try {
            $response = Http::withBasicAuth($this->secretKey(), '')->acceptJson()->asJson()->timeout(15)->post(
                'https://api.paymongo.com/v1/checkout_sessions',
                ['data' => ['attributes' => [
                    'billing' => ['name' => $input['customerName'], 'email' => $input['customerEmail']],
                    'cancel_url' => $cancel, 'success_url' => $success,
                    'description' => 'CampusGig order '.$input['orderNumber'],
                    'reference_number' => $input['orderNumber'], 'send_email_receipt' => true,
                    'show_description' => true, 'show_line_items' => true,
                    'payment_method_types' => config('campusgig.paymongo.payment_methods'),
                    'line_items' => [[
                        'amount' => $input['amountCentavos'], 'currency' => strtoupper($input['currency'] ?? 'PHP'),
                        'description' => 'Student service for '.$input['orderNumber'],
                        'name' => $input['title'], 'quantity' => 1,
                    ]],
                ]]],
            );
        } catch (ConnectionException) {
            throw new PaymongoCheckoutException(
                'PayMongo is temporarily unavailable. CampusGig will verify whether the checkout was created before allowing another attempt.',
                'UNKNOWN',
            );
        }
        $payload = $response->json();
        if (! $response->successful()) {
            $outcome = in_array($response->status(), [400, 401, 403, 404, 422], true) ? 'REJECTED' : 'UNKNOWN';
            throw new PaymongoCheckoutException(data_get($payload, 'errors.0.detail', 'PayMongo could not create the checkout'), $outcome);
        }
        $id = data_get($payload, 'data.id');
        $url = data_get($payload, 'data.attributes.checkout_url');
        if (! is_string($id) || $id === '' || ! is_string($url) || filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw new PaymongoCheckoutException('PayMongo returned an incomplete checkout response. CampusGig will verify the payment before allowing another attempt.', 'UNKNOWN');
        }

        return ['id' => $id, 'checkoutUrl' => $url];
    }

    public function paidCheckout(string $checkoutId): ?array
    {
        try {
            $response = Http::withBasicAuth($this->secretKey(), '')->acceptJson()->timeout(10)
                ->get('https://api.paymongo.com/v1/checkout_sessions/'.rawurlencode($checkoutId));
        } catch (ConnectionException) {
            throw $this->badGateway('PayMongo payment verification is temporarily unavailable');
        }
        if (! $response->successful()) {
            throw $this->badGateway('PayMongo payment verification is temporarily unavailable');
        }
        $resource = data_get($response->json(), 'data');
        if (data_get($resource, 'id') !== $checkoutId) {
            throw $this->badGateway('PayMongo returned the wrong checkout');
        }
        $paid = collect(data_get($resource, 'attributes.payments', []))
            ->first(fn (mixed $payment): bool => data_get($payment, 'attributes.status') === 'paid');
        if (! $paid) {
            return null;
        }
        $id = data_get($paid, 'id');
        $amount = data_get($paid, 'attributes.amount');
        $currency = strtoupper(trim((string) data_get($paid, 'attributes.currency')));
        $paidAt = data_get($paid, 'attributes.paid_at');
        if (! is_string($id) || $id === '' || ! is_int($amount) || $amount <= 0
            || $currency === '' || ! is_int($paidAt) || $paidAt <= 0) {
            throw $this->badGateway('PayMongo returned incomplete payment evidence');
        }

        return [
            'id' => $id, 'amountCentavos' => $amount, 'currency' => $currency,
            'paidAt' => CarbonImmutable::createFromTimestampUTC($paidAt),
        ];
    }

    public function verifyWebhook(string $rawBody, ?string $signature): void
    {
        $secret = $this->required('webhook_secret', 'PAYMONGO_WEBHOOK_SECRET');
        if (! $signature) {
            throw $this->unauthorized('Missing PayMongo signature');
        }
        $fields = [];
        foreach (explode(',', $signature) as $part) {
            $pair = explode('=', trim($part), 2);
            if (count($pair) === 2) {
                $fields[$pair[0]] = $pair[1];
            }
        }
        $timestamp = $fields['t'] ?? null;
        $provided = $fields[$this->mode() === 'live' ? 'li' : 'te'] ?? null;
        if (! is_string($timestamp) || preg_match('/^\d+$/', $timestamp) !== 1 || ! is_string($provided)
            || abs(time() - (int) $timestamp) > 300) {
            throw $this->unauthorized('Invalid or expired PayMongo signature');
        }
        $expected = hash_hmac('sha256', $timestamp.'.'.$rawBody, $secret);
        if (! hash_equals($expected, $provided)) {
            throw $this->unauthorized('Invalid PayMongo signature');
        }
    }

    public function createRefund(array $input): array
    {
        try {
            $response = Http::withBasicAuth($this->secretKey(), '')->acceptJson()->asJson()->timeout(15)
                ->withHeader('Idempotency-Key', $input['idempotencyKey'])
                ->post('https://api.paymongo.com/v1/refunds', ['data' => ['attributes' => [
                    'amount' => $input['amountCentavos'], 'payment_id' => $input['paymentId'],
                    'reason' => 'others', 'notes' => $input['notes'],
                ]]]);
        } catch (ConnectionException) {
            throw new PaymongoRefundException(
                'PayMongo did not confirm the refund outcome. Reconciliation is required before any retry.',
                'UNKNOWN',
            );
        }
        $payload = $response->json();
        if (! $response->successful()) {
            $outcome = in_array($response->status(), [400, 401, 403, 404, 422], true) ? 'REJECTED' : 'UNKNOWN';
            throw new PaymongoRefundException(
                data_get($payload, 'errors.0.detail', 'PayMongo could not process the refund'),
                $outcome,
                data_get($payload, 'errors.0.code'),
            );
        }

        return $this->parseRefundResponse($payload);
    }

    public function retrieveRefund(string $refundId): array
    {
        try {
            $response = Http::withBasicAuth($this->secretKey(), '')->acceptJson()->timeout(15)
                ->get('https://api.paymongo.com/v1/refunds/'.rawurlencode($refundId));
        } catch (ConnectionException) {
            throw new PaymongoRefundException('PayMongo refund reconciliation is temporarily unavailable.', 'UNKNOWN');
        }
        $payload = $response->json();
        if (! $response->successful()) {
            throw new PaymongoRefundException(
                data_get($payload, 'errors.0.detail', 'PayMongo could not retrieve the refund'),
                'UNKNOWN',
                data_get($payload, 'errors.0.code'),
            );
        }

        return $this->parseRefundResponse($payload);
    }

    private function parseRefundResponse(array $payload): array
    {
        $resource = data_get($payload, 'data');
        $attributes = data_get($resource, 'attributes');
        $status = data_get($attributes, 'status');
        if (! is_string(data_get($resource, 'id')) || ! is_int(data_get($attributes, 'amount'))
            || data_get($attributes, 'amount') <= 0 || ! is_string(data_get($attributes, 'payment_id'))
            || ! is_string(data_get($attributes, 'currency'))
            || ! in_array($status, ['pending', 'processing', 'succeeded', 'failed'], true)) {
            throw new PaymongoRefundException('PayMongo returned an incomplete refund response. Reconciliation is required.', 'UNKNOWN');
        }

        return [
            'id' => $resource['id'], 'amountCentavos' => $attributes['amount'],
            'currency' => strtoupper($attributes['currency']), 'paymentId' => $attributes['payment_id'],
            'reason' => $attributes['reason'] ?? 'others', 'status' => $status,
            'createdAt' => isset($attributes['created_at']) ? CarbonImmutable::createFromTimestampUTC((int) $attributes['created_at']) : null,
            'updatedAt' => isset($attributes['updated_at']) ? CarbonImmutable::createFromTimestampUTC((int) $attributes['updated_at']) : null,
        ];
    }

    public function mode(): string
    {
        $mode = (string) config('campusgig.paymongo.mode');
        if (! in_array($mode, ['test', 'live'], true)) {
            throw $this->unavailable('PAYMONGO_MODE must be test or live');
        }

        return $mode;
    }

    private function secretKey(): string
    {
        $mode = $this->mode();
        if ($mode === 'live' && ! app()->environment('production')) {
            throw $this->unavailable('PayMongo live mode requires the production environment');
        }
        $key = $this->required('secret_key', 'PAYMONGO_SECRET_KEY');
        if (! str_starts_with($key, $mode === 'live' ? 'sk_live_' : 'sk_test_')) {
            throw $this->unavailable("PAYMONGO_SECRET_KEY does not match PayMongo {$mode} mode");
        }

        return $key;
    }

    private function returnUrl(string $key, string $origin, string $status, string $orderId, string $target, ?string $revisionPurchaseId = null): string
    {
        $template = trim((string) config("campusgig.paymongo.{$key}"));
        $url = $template !== '' ? str_replace(['{ORDER_ID}', '{orderId}'], rawurlencode($orderId), $template) : $origin;
        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw $this->unavailable('PayMongo return URL is invalid');
        }
        $separator = str_contains($url, '?') ? '&' : '?';

        return $url.$separator.http_build_query(array_filter([
            'payment' => $status, 'orderId' => $orderId, 'paymentTarget' => $target === 'MOBILE' ? 'mobile' : null,
            'revisionPurchaseId' => $revisionPurchaseId,
        ]));
    }

    private function required(string $key, string $label): string
    {
        $value = trim((string) config("campusgig.paymongo.{$key}"));
        if ($value === '') {
            throw $this->unavailable("{$label} is not configured");
        }

        return $value;
    }

    private function unauthorized(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Unauthorized', 'statusCode' => 401], 401));
    }

    private function unavailable(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Service Unavailable', 'statusCode' => 503], 503));
    }

    private function badGateway(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Bad Gateway', 'statusCode' => 502], 502));
    }
}
