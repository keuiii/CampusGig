<?php

namespace App\Services\Auth;

use App\Models\AuthSession;
use App\Models\RefreshToken;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class SessionService
{
    public function __construct(private readonly TokenCodec $tokens) {}

    public function create(User $user, array $context): array
    {
        $refreshToken = $this->newRefreshToken();
        $absoluteExpiry = now()->addDays($this->absoluteDays());
        $refreshExpiry = now()->addDays($this->idleDays())->min($absoluteExpiry);

        $session = DB::transaction(function () use ($user, $context, $refreshToken, $absoluteExpiry, $refreshExpiry): AuthSession {
            $session = AuthSession::query()->create([
                'id' => (string) Str::uuid(),
                'userId' => $user->id,
                'clientType' => $context['clientType'],
                'deviceName' => $this->deviceName($context['deviceName']),
                'sessionVersion' => $user->sessionVersion,
                'expiresAt' => $absoluteExpiry,
                'lastUsedAt' => now(),
            ]);
            RefreshToken::query()->create([
                'id' => (string) Str::uuid(),
                'sessionId' => $session->id,
                'tokenHash' => $this->hashToken($refreshToken),
                'expiresAt' => $refreshExpiry,
            ]);

            return $session;
        });

        return $this->issueResult($user, $session, $refreshToken, $refreshExpiry);
    }

    public function refresh(string $plainToken): array
    {
        if (strlen($plainToken) < 32) {
            throw $this->invalidRefresh();
        }

        $outcome = DB::transaction(function () use ($plainToken): ?array {
            $current = RefreshToken::query()
                ->where('tokenHash', $this->hashToken($plainToken))
                ->lockForUpdate()
                ->first();
            if (! $current) {
                return null;
            }

            $session = AuthSession::query()->whereKey($current->sessionId)->lockForUpdate()->first();
            $user = $session ? User::query()->with('roleAssignments')->whereKey($session->userId)->lockForUpdate()->first() : null;
            if (! $session || ! $user) {
                return null;
            }

            if ($current->revokedAt) {
                $this->revokeFamily($session, 'TOKEN_REUSE');

                return null;
            }
            if ($current->expiresAt->isPast() || $session->expiresAt->isPast() || $session->revokedAt || $user->status !== 'ACTIVE' || $user->sessionVersion !== $session->sessionVersion) {
                $this->revokeFamily($session, 'EXPIRED_OR_INVALID');

                return null;
            }

            $nextToken = $this->deriveNextRefreshToken($plainToken, $session->id);
            if ($current->usedAt) {
                $age = $current->usedAt->diffInSeconds(now(), false);
                $successor = RefreshToken::query()->where('tokenHash', $this->hashToken($nextToken))->first();
                if ($age >= 0 && $age <= $this->replayGraceSeconds() && $successor && ! $successor->revokedAt && $successor->expiresAt->isFuture()) {
                    return compact('user', 'session', 'nextToken') + ['refreshExpiry' => $successor->expiresAt];
                }
                $this->revokeFamily($session, 'TOKEN_REUSE');

                return null;
            }

            $current->forceFill(['usedAt' => now()])->save();
            $nextExpiry = now()->addDays($this->idleDays())->min($session->expiresAt);
            RefreshToken::query()->create([
                'id' => (string) Str::uuid(),
                'sessionId' => $session->id,
                'tokenHash' => $this->hashToken($nextToken),
                'expiresAt' => $nextExpiry,
            ]);
            $session->forceFill(['lastUsedAt' => now()])->save();

            return compact('user', 'session', 'nextToken') + ['refreshExpiry' => $nextExpiry];
        }, 3);

        if (! $outcome) {
            throw $this->invalidRefresh();
        }

        return $this->issueResult($outcome['user'], $outcome['session'], $outcome['nextToken'], $outcome['refreshExpiry']);
    }

    public function list(string $userId, ?string $currentSessionId): array
    {
        $user = User::query()->findOrFail($userId);
        $sessions = AuthSession::query()
            ->where('userId', $userId)
            ->where('sessionVersion', $user->sessionVersion)
            ->whereNull('revokedAt')
            ->where('expiresAt', '>', now())
            ->latest('lastUsedAt')
            ->get(['id', 'clientType', 'deviceName', 'createdAt', 'lastUsedAt', 'expiresAt']);

        return ['data' => $sessions->map(fn (AuthSession $session): array => [
            ...$session->toArray(),
            'current' => $session->id === $currentSessionId,
        ])->all()];
    }

    public function revoke(string $userId, string $sessionId, string $reason = 'USER_LOGOUT'): array
    {
        $count = DB::transaction(function () use ($userId, $sessionId, $reason): int {
            $session = AuthSession::query()->whereKey($sessionId)->where('userId', $userId)->whereNull('revokedAt')->lockForUpdate()->first();
            if (! $session) {
                return 0;
            }
            $this->revokeFamily($session, $reason);

            return 1;
        });

        return ['revoked' => $count];
    }

    public function revokeByToken(?string $plainToken): array
    {
        if (! $plainToken) {
            return ['revoked' => 0];
        }
        $token = RefreshToken::query()->where('tokenHash', $this->hashToken($plainToken))->first();
        $session = $token ? AuthSession::query()->find($token->sessionId) : null;

        return $session ? $this->revoke($session->userId, $session->id) : ['revoked' => 0];
    }

    public function revokeAll(User $user): array
    {
        $count = DB::transaction(function () use ($user): int {
            $sessionIds = AuthSession::query()->where('userId', $user->id)->whereNull('revokedAt')->pluck('id');
            $user->increment('sessionVersion');
            AuthSession::query()->whereIn('id', $sessionIds)->update(['revokedAt' => now(), 'revokedReason' => 'LOGOUT_ALL']);
            RefreshToken::query()->whereIn('sessionId', $sessionIds)->whereNull('revokedAt')->update(['revokedAt' => now()]);

            return $sessionIds->count();
        });

        return ['revoked' => $count];
    }

    public function replacePasswordAndRevokeSessions(User $user, string $passwordHash): void
    {
        DB::transaction(function () use ($user, $passwordHash): void {
            $sessionIds = AuthSession::query()->where('userId', $user->id)->whereNull('revokedAt')->pluck('id');
            $user->forceFill([
                'passwordHash' => $passwordHash,
                'sessionVersion' => $user->sessionVersion + 1,
            ])->save();
            AuthSession::query()->whereIn('id', $sessionIds)->update([
                'revokedAt' => now(),
                'revokedReason' => 'PASSWORD_RESET',
            ]);
            RefreshToken::query()->whereIn('sessionId', $sessionIds)->whereNull('revokedAt')->update(['revokedAt' => now()]);
        });
    }

    private function issueResult(User $user, AuthSession $session, string $refreshToken, $refreshExpiry): array
    {
        $authenticated = $this->authenticatedUser($user);

        return [
            'accessToken' => $this->tokens->issue([
                'sub' => $user->id,
                'email' => $user->email,
                'roles' => $authenticated['roles'],
                'sessionVersion' => $session->sessionVersion,
                'sid' => $session->id,
            ]),
            'tokenType' => 'Bearer',
            'expiresIn' => $this->tokens->ttl(),
            'refreshToken' => $refreshToken,
            // Carbon 3 returns fractional seconds. Keep the JSON contract as an
            // integer so strongly typed clients can deserialize auth responses.
            'refreshExpiresIn' => max(0, (int) floor(now()->diffInSeconds($refreshExpiry, false))),
            'user' => $authenticated,
        ];
    }

    public function authenticatedUser(User $user): array
    {
        $user->loadMissing('roleAssignments');

        return [
            'id' => $user->id,
            'email' => $user->email,
            'displayName' => $user->displayName,
            'hasAvatar' => filled($user->avatarPath),
            'status' => $user->status,
            'roles' => $user->roleAssignments->pluck('role')->values()->all(),
        ];
    }

    private function revokeFamily(AuthSession $session, string $reason): void
    {
        $session->forceFill(['revokedAt' => now(), 'revokedReason' => $reason])->save();
        RefreshToken::query()->where('sessionId', $session->id)->whereNull('revokedAt')->update(['revokedAt' => now()]);
    }

    private function newRefreshToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
    }

    private function deriveNextRefreshToken(string $token, string $sessionId): string
    {
        return rtrim(strtr(base64_encode(hash_hmac('sha384', "refresh:{$sessionId}:{$token}", (string) config('campusgig.jwt_secret'), true)), '+/', '-_'), '=');
    }

    private function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    private function deviceName(string $value): string
    {
        $value = Str::limit(str_replace(["\r", "\n"], ' ', trim($value)), 100, '');

        return $value !== '' ? $value : 'Unknown device';
    }

    private function idleDays(): int
    {
        return $this->bounded('campusgig.refresh_token_idle_days', 1, 30);
    }

    private function absoluteDays(): int
    {
        return $this->bounded('campusgig.refresh_token_absolute_days', $this->idleDays(), 90);
    }

    private function replayGraceSeconds(): int
    {
        return $this->bounded('campusgig.refresh_token_replay_grace_seconds', 5, 60);
    }

    private function bounded(string $key, int $minimum, int $maximum): int
    {
        $value = config($key);
        if (! is_int($value) || $value < $minimum || $value > $maximum) {
            throw new RuntimeException("{$key} must be between {$minimum} and {$maximum}.");
        }

        return $value;
    }

    private function invalidRefresh(): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => 'Refresh session is invalid or expired',
            'error' => 'Unauthorized',
            'statusCode' => 401,
        ], 401));
    }
}
