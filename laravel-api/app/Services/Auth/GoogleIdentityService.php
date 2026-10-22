<?php

namespace App\Services\Auth;

use Firebase\JWT\JWK;
use Firebase\JWT\JWT;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

class GoogleIdentityService
{
    private const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

    public function verify(string $idToken): array
    {
        $audiences = config('campusgig.google_client_ids', []);
        if (! is_array($audiences) || $audiences === []) {
            throw $this->error(503, 'Google sign-in is not configured yet', 'Service Unavailable');
        }

        try {
            $keys = Cache::remember('google-oidc-jwks', now()->addHour(), function (): array {
                $response = Http::acceptJson()->timeout(10)->get(self::CERTS_URL);
                if (! $response->successful()) {
                    throw new \RuntimeException('Google keys unavailable.');
                }

                return $response->json();
            });
            $claims = (array) JWT::decode($idToken, JWK::parseKeySet($keys));
        } catch (Throwable) {
            throw $this->error(401, 'Google could not verify this account', 'Unauthorized');
        }

        $audience = $claims['aud'] ?? null;
        $audienceValid = is_string($audience)
            ? in_array($audience, $audiences, true)
            : (is_array($audience) && array_intersect($audience, $audiences) !== []);
        if (! $audienceValid || ! in_array($claims['iss'] ?? null, ['accounts.google.com', 'https://accounts.google.com'], true)
            || ! is_string($claims['sub'] ?? null) || ! is_string($claims['email'] ?? null)
            || filter_var($claims['email'], FILTER_VALIDATE_EMAIL) === false || ($claims['email_verified'] ?? false) !== true) {
            throw $this->error(401, 'Google could not verify this account', 'Unauthorized');
        }

        return [
            'sub' => $claims['sub'],
            'email' => strtolower(trim($claims['email'])),
            'name' => is_string($claims['name'] ?? null) ? trim($claims['name']) : null,
            'hd' => is_string($claims['hd'] ?? null) ? $claims['hd'] : null,
        ];
    }

    private function error(int $status, string $message, string $title): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $title, 'statusCode' => $status], $status));
    }
}
