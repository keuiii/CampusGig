<?php

namespace App\Services\Auth;

use App\Models\MfaChallenge;
use App\Models\MfaRecoveryCode;
use App\Models\TrustedDevice;
use App\Models\User;
use BaconQrCode\Renderer\Image\SvgImageBackEnd;
use BaconQrCode\Renderer\ImageRenderer;
use BaconQrCode\Renderer\RendererStyle\RendererStyle;
use BaconQrCode\Writer;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class MfaService
{
    public function status(User $user): array
    {
        $user->loadMissing('roleAssignments');

        return [
            'enabled' => (bool) $user->mfaEnabledAt,
            'enabledAt' => $user->mfaEnabledAt,
            'recoveryCodesRemaining' => MfaRecoveryCode::query()->where('userId', $user->id)->whereNull('usedAt')->count(),
            'required' => $user->roleAssignments->pluck('role')->contains(fn (string $role): bool => in_array($role, ['ADMIN', 'SCHOOL_ADMIN'], true)),
        ];
    }

    public function beginSetup(User $user): array
    {
        $secret = $this->base32Encode(random_bytes(20));
        $user->forceFill(['mfaPendingSecretCipher' => $this->encrypt($secret)])->save();
        $uri = 'otpauth://totp/'.rawurlencode("CampusGig:{$user->email}").'?'.http_build_query([
            'secret' => $secret, 'issuer' => 'CampusGig', 'algorithm' => 'SHA1', 'digits' => 6, 'period' => 30,
        ], '', '&', PHP_QUERY_RFC3986);
        $svg = (new Writer(new ImageRenderer(new RendererStyle(280, 1), new SvgImageBackEnd)))->writeString($uri);

        return ['secret' => $secret, 'otpauthUri' => $uri, 'qrCodeDataUrl' => 'data:image/svg+xml;base64,'.base64_encode($svg)];
    }

    public function confirmSetup(User $user, string $token): array
    {
        if (! $user->mfaPendingSecretCipher) {
            throw $this->error(400, 'Start authenticator setup first', 'Bad Request');
        }
        $secret = $this->decrypt($user->mfaPendingSecretCipher);
        $this->requireValidTotp($secret, $token);
        $codes = $this->createRecoveryCodes();

        DB::transaction(function () use ($user, $secret, $codes): void {
            MfaRecoveryCode::query()->where('userId', $user->id)->delete();
            foreach ($codes as $code) {
                MfaRecoveryCode::query()->create([
                    'id' => (string) Str::uuid(), 'userId' => $user->id,
                    'codeHash' => password_hash($this->normalizeRecoveryCode($code), PASSWORD_BCRYPT, ['cost' => 10]),
                ]);
            }
            $user->forceFill([
                'mfaEnabledAt' => now(), 'mfaSecretCipher' => $this->encrypt($secret),
                'mfaPendingSecretCipher' => null, 'mfaLastUsedStep' => $this->currentStep(),
            ])->save();
        });

        return ['enabled' => true, 'recoveryCodes' => $codes];
    }

    public function createChallenge(string $userId): string
    {
        $token = $this->base64Url(random_bytes(32));
        MfaChallenge::query()->create([
            'id' => (string) Str::uuid(), 'userId' => $userId, 'tokenHash' => hash('sha256', $token),
            'attempts' => 0, 'expiresAt' => now()->addMinutes(5),
        ]);

        return $token;
    }

    public function verifyChallenge(string $challengeToken, string $code, bool $recoveryCode, bool $rememberDevice): array
    {
        $result = DB::transaction(function () use ($challengeToken, $code, $recoveryCode, $rememberDevice): array {
            $challenge = MfaChallenge::query()->where('tokenHash', hash('sha256', $challengeToken))->lockForUpdate()->first();
            if (! $challenge || $challenge->consumedAt || $challenge->expiresAt->isPast() || $challenge->attempts >= 5) {
                throw $this->error(401, 'Invalid or expired sign-in challenge', 'Unauthorized');
            }
            $user = User::query()->with('roleAssignments')->whereKey($challenge->userId)->lockForUpdate()->first();
            if (! $user) {
                throw $this->error(401, 'Invalid or expired sign-in challenge', 'Unauthorized');
            }
            try {
                $recoveryCode ? $this->consumeRecoveryCode($user->id, $code) : $this->verifyCurrentCodeLocked($user, $code);
            } catch (HttpResponseException $exception) {
                $challenge->increment('attempts');

                return ['failure' => $exception];
            }
            $challenge->forceFill(['consumedAt' => now()])->save();

            return ['user' => $user, ...($rememberDevice ? ['trustedDeviceToken' => $this->issueTrustedDevice($user->id)] : [])];
        }, 3);
        if (isset($result['failure'])) {
            throw $result['failure'];
        }

        return $result;
    }

    public function isTrustedDevice(string $userId, ?string $token): bool
    {
        if (! $token) {
            return false;
        }
        $device = TrustedDevice::query()->where('tokenHash', hash('sha256', $token))->first();
        if (! $device || $device->userId !== $userId || $device->revokedAt || $device->expiresAt->isPast()) {
            return false;
        }
        $device->forceFill(['lastUsedAt' => now()])->save();

        return true;
    }

    public function verifyCurrentCode(User $user, string $token): void
    {
        DB::transaction(function () use ($user, $token): void {
            $locked = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $this->verifyCurrentCodeLocked($locked, $token);
            $user->forceFill(['mfaLastUsedStep' => $locked->mfaLastUsedStep]);
        }, 3);
    }

    public function verifyCurrentFactor(User $user, string $code, bool $recoveryCode): void
    {
        if ($recoveryCode) {
            $this->consumeRecoveryCode($user->id, $code);

            return;
        }
        $this->verifyCurrentCode($user, $code);
    }

    public function disable(User $user): array
    {
        DB::transaction(function () use ($user): void {
            MfaRecoveryCode::query()->where('userId', $user->id)->delete();
            MfaChallenge::query()->where('userId', $user->id)->delete();
            $user->forceFill(['mfaEnabledAt' => null, 'mfaSecretCipher' => null, 'mfaPendingSecretCipher' => null, 'mfaLastUsedStep' => null])->save();
        });

        return ['enabled' => false];
    }

    public function regenerateRecoveryCodes(User $user): array
    {
        $codes = $this->createRecoveryCodes();
        DB::transaction(function () use ($user, $codes): void {
            MfaRecoveryCode::query()->where('userId', $user->id)->delete();
            foreach ($codes as $code) {
                MfaRecoveryCode::query()->create(['id' => (string) Str::uuid(), 'userId' => $user->id, 'codeHash' => password_hash($this->normalizeRecoveryCode($code), PASSWORD_BCRYPT, ['cost' => 10])]);
            }
        });

        return ['recoveryCodes' => $codes];
    }

    public function revokeTrustedDevices(string $userId): array
    {
        return ['revoked' => TrustedDevice::query()->where('userId', $userId)->whereNull('revokedAt')->update(['revokedAt' => now()])];
    }

    public function trustedDeviceCount(string $userId): int
    {
        return TrustedDevice::query()->where('userId', $userId)->whereNull('revokedAt')->where('expiresAt', '>', now())->count();
    }

    private function consumeRecoveryCode(string $userId, string $plainCode): void
    {
        $normalized = $this->normalizeRecoveryCode($plainCode);
        foreach (MfaRecoveryCode::query()->where('userId', $userId)->whereNull('usedAt')->lockForUpdate()->get() as $code) {
            if (password_verify($normalized, $code->codeHash)) {
                $code->forceFill(['usedAt' => now()])->save();

                return;
            }
        }
        throw $this->error(401, 'Invalid recovery code', 'Unauthorized');
    }

    private function verifyCurrentCodeLocked(User $user, string $token): void
    {
        if (! $user->mfaEnabledAt || ! $user->mfaSecretCipher) {
            throw $this->error(400, 'Authenticator verification is not enabled', 'Bad Request');
        }
        $step = $this->currentStep();
        if ($user->mfaLastUsedStep !== null && $step <= $user->mfaLastUsedStep) {
            throw $this->error(401, 'Wait for a new authenticator code', 'Unauthorized');
        }
        $this->requireValidTotp($this->decrypt($user->mfaSecretCipher), $token);
        $user->forceFill(['mfaLastUsedStep' => $step])->save();
    }

    private function issueTrustedDevice(string $userId): string
    {
        $token = $this->base64Url(random_bytes(32));
        TrustedDevice::query()->create(['id' => (string) Str::uuid(), 'userId' => $userId, 'tokenHash' => hash('sha256', $token), 'expiresAt' => now()->addDays(30), 'lastUsedAt' => now()]);

        return $token;
    }

    private function requireValidTotp(string $secret, string $token): void
    {
        if (! preg_match('/^\d{6}$/', $token)) {
            throw $this->error(401, 'Invalid authenticator code', 'Unauthorized');
        }
        $key = $this->base32Decode($secret);
        $current = $this->currentStep();
        foreach ([$current - 1, $current, $current + 1] as $step) {
            $hash = hash_hmac('sha1', pack('N2', 0, $step), $key, true);
            $offset = ord($hash[19]) & 0x0F;
            $binary = ((ord($hash[$offset]) & 0x7F) << 24) | ((ord($hash[$offset + 1]) & 0xFF) << 16) | ((ord($hash[$offset + 2]) & 0xFF) << 8) | (ord($hash[$offset + 3]) & 0xFF);
            if (hash_equals(str_pad((string) ($binary % 1000000), 6, '0', STR_PAD_LEFT), $token)) {
                return;
            }
        }
        throw $this->error(401, 'Invalid authenticator code', 'Unauthorized');
    }

    private function encrypt(string $value): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $encrypted = openssl_encrypt($value, 'aes-256-gcm', $this->encryptionKey(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($encrypted === false) {
            throw new RuntimeException('Could not encrypt MFA secret.');
        }

        return implode('.', array_map(fn (string $part): string => $this->base64Url($part), [$iv, $tag, $encrypted]));
    }

    private function decrypt(string $value): string
    {
        $parts = array_map(fn (string $part): string => $this->base64UrlDecode($part), explode('.', $value));
        if (count($parts) !== 3) {
            throw new RuntimeException('Invalid MFA secret.');
        }
        $plain = openssl_decrypt($parts[2], 'aes-256-gcm', $this->encryptionKey(), OPENSSL_RAW_DATA, $parts[0], $parts[1]);
        if ($plain === false) {
            throw new RuntimeException('Invalid MFA secret.');
        }

        return $plain;
    }

    private function encryptionKey(): string
    {
        $configured = (string) config('campusgig.mfa_encryption_key');
        if ($configured === '' && app()->isProduction()) {
            throw new RuntimeException('MFA_ENCRYPTION_KEY is required in production.');
        }

        return hash('sha256', $configured !== '' ? $configured : (string) config('campusgig.jwt_secret'), true);
    }

    private function createRecoveryCodes(): array
    {
        return array_map(fn (): string => ($value = strtoupper(bin2hex(random_bytes(5)))) ? substr($value, 0, 5).'-'.substr($value, 5) : '', range(1, 10));
    }

    private function normalizeRecoveryCode(string $code): string
    {
        return strtoupper(preg_replace('/[^a-zA-Z0-9]/', '', $code) ?? '');
    }

    private function currentStep(): int
    {
        return intdiv(time(), 30);
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        return base64_decode(strtr($value, '-_', '+/').str_repeat('=', (4 - strlen($value) % 4) % 4), true) ?: '';
    }

    private function base32Encode(string $value): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split($value) as $char) {
            $bits .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
        }
        $result = '';
        foreach (str_split($bits, 5) as $chunk) {
            $result .= $alphabet[bindec(str_pad($chunk, 5, '0'))];
        }

        return $result;
    }

    private function base32Decode(string $value): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split(strtoupper(rtrim($value, '='))) as $char) {
            $position = strpos($alphabet, $char);
            if ($position === false) {
                throw new RuntimeException('Invalid MFA secret.');
            }
            $bits .= str_pad(decbin($position), 5, '0', STR_PAD_LEFT);
        }
        $result = '';
        foreach (str_split($bits, 8) as $chunk) {
            if (strlen($chunk) === 8) {
                $result .= chr(bindec($chunk));
            }
        }

        return $result;
    }

    private function error(int $status, string $message, string $title): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $title, 'statusCode' => $status], $status));
    }
}
