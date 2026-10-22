<?php

namespace App\Http\Middleware;

use App\Models\AuthSession;
use App\Models\User;
use App\Services\Auth\TokenCodec;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateAccessToken
{
    public function __construct(private readonly TokenCodec $tokens) {}

    public function handle(Request $request, Closure $next): Response
    {
        $plainToken = $request->bearerToken();
        $payload = $plainToken ? $this->tokens->decode($plainToken) : null;
        $userId = is_string($payload['sub'] ?? null) ? $payload['sub'] : null;
        $sessionId = is_string($payload['sid'] ?? null) ? $payload['sid'] : null;
        $sessionVersion = is_int($payload['sessionVersion'] ?? null) ? $payload['sessionVersion'] : null;

        $user = $userId ? User::query()->with('roleAssignments')->find($userId) : null;
        $session = $sessionId ? AuthSession::query()->find($sessionId) : null;
        if (! $user || ! $session || $user->status !== 'ACTIVE' || $session->userId !== $user->id || $session->revokedAt || $session->expiresAt->isPast() || $sessionVersion !== $user->sessionVersion || $sessionVersion !== $session->sessionVersion) {
            return response()->json([
                'message' => 'Unauthorized',
                'error' => 'Unauthorized',
                'statusCode' => 401,
            ], 401);
        }

        $request->attributes->set('auth.user', $user);
        $request->attributes->set('auth.sessionId', $session->id);

        return $next($request);
    }
}
