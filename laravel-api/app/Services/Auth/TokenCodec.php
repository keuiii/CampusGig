<?php

namespace App\Services\Auth;

use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use RuntimeException;
use Throwable;

class TokenCodec
{
    public function issue(array $claims): string
    {
        $now = time();
        $claims['iat'] = $now;
        $claims['exp'] = $now + $this->ttl();

        return JWT::encode($claims, $this->secret(), 'HS256');
    }

    public function decode(string $token): ?array
    {
        try {
            return (array) JWT::decode($token, new Key($this->secret(), 'HS256'));
        } catch (Throwable) {
            return null;
        }
    }

    public function ttl(): int
    {
        return $this->boundedInteger('campusgig.access_token_ttl_seconds', 300, 3600);
    }

    private function secret(): string
    {
        $secret = (string) config('campusgig.jwt_secret');
        if (strlen($secret) < 32) {
            throw new RuntimeException('JWT_SECRET must contain at least 32 characters.');
        }

        return $secret;
    }

    private function boundedInteger(string $key, int $minimum, int $maximum): int
    {
        $value = config($key);
        if (! is_int($value) || $value < $minimum || $value > $maximum) {
            throw new RuntimeException("{$key} must be between {$minimum} and {$maximum}.");
        }

        return $value;
    }
}
