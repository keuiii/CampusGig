<?php

namespace App\Services\Auth;

use App\Models\PasswordChangeRequest;
use App\Models\User;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

class PasswordChangeService
{
    public function __construct(
        private readonly MfaService $mfa,
        private readonly SessionService $sessions,
    ) {}

    public function request(User $user, array $input, string $origin): array
    {
        if (! password_verify($input['currentPassword'], $user->passwordHash)) {
            throw $this->error(401, 'Current password is incorrect', 'Unauthorized');
        }
        if (password_verify($input['newPassword'], $user->passwordHash)) {
            throw $this->error(400, 'Choose a new password different from your current password', 'Bad Request');
        }

        $newHash = password_hash($input['newPassword'], PASSWORD_BCRYPT, ['cost' => 12]);
        if ($user->mfaEnabledAt) {
            if (! isset($input['mfaCode'])) {
                throw $this->error(401, 'Enter your authenticator code or a recovery code', 'Unauthorized');
            }
            $this->mfa->verifyCurrentFactor($user, $input['mfaCode'], $input['recoveryCode'] ?? false);
            $this->sessions->replacePasswordAndRevokeSessions($user, $newHash);
            PasswordChangeRequest::query()->where('userId', $user->id)->where('status', 'PENDING')->update(['status' => 'CANCELLED', 'respondedAt' => now()]);
            $revoked = $this->mfa->revokeTrustedDevices($user->id)['revoked'];
            $this->sendPasswordChanged($user->email);

            return [
                'status' => 'CONFIRMED',
                'confirmationMethod' => ($input['recoveryCode'] ?? false) ? 'RECOVERY_CODE' : 'AUTHENTICATOR',
                'revokedTrustedDevices' => $revoked,
                'message' => 'Password changed successfully. Remembered devices must verify again.',
            ];
        }

        $this->expireOld($user->id);
        if (PasswordChangeRequest::query()->where('userId', $user->id)->where('status', 'PENDING')->where('expiresAt', '>', now())->exists()) {
            throw $this->error(409, 'A password change is already waiting for email confirmation', 'Conflict');
        }

        $token = $this->base64Url(random_bytes(32));
        $expiresAt = now()->addMinutes(15);
        $change = PasswordChangeRequest::query()->create([
            'id' => (string) Str::uuid(), 'userId' => $user->id,
            'newPasswordHash' => $newHash, 'tokenHash' => hash('sha256', $token),
            'status' => 'PENDING', 'expiresAt' => $expiresAt,
        ]);
        $base = rtrim((string) (config('campusgig.email_action_base_url') ?: $origin), '/');
        $reviewUrl = $base.'/api/v1/auth/password-change/review?token='.rawurlencode($token);
        try {
            Mail::raw("A password change was requested for your CampusGig account. Review it before {$expiresAt->timezone('Asia/Manila')->format('M j, Y g:i A')} Philippine time: {$reviewUrl}", function ($message) use ($user): void {
                $message->to($user->email)->subject('Confirm your CampusGig password change');
            });
        } catch (Throwable) {
            $change->delete();
            throw $this->error(503, 'The confirmation email could not be sent. Your password was not changed.', 'Service Unavailable');
        }

        return ['id' => $change->id, 'status' => 'PENDING', 'expiresAt' => $expiresAt, 'message' => 'Check your email to approve or reject this password change.'];
    }

    public function pending(string $userId): ?array
    {
        $this->expireOld($userId);
        $change = PasswordChangeRequest::query()->where('userId', $userId)->where('status', 'PENDING')->latest('createdAt')->first();

        return $change ? $this->toStatus($change) : null;
    }

    public function status(string $userId, string $id): array
    {
        $this->expireOld($userId);
        $change = PasswordChangeRequest::query()->whereKey($id)->where('userId', $userId)->first();
        if (! $change) {
            throw $this->error(400, 'Password request not found', 'Bad Request');
        }

        return $this->toStatus($change);
    }

    public function cancel(string $userId, string $id): array
    {
        $count = PasswordChangeRequest::query()->whereKey($id)->where('userId', $userId)->where('status', 'PENDING')->update(['status' => 'CANCELLED', 'respondedAt' => now()]);
        if ($count !== 1) {
            throw $this->error(400, 'This password request is no longer active', 'Bad Request');
        }

        return ['id' => $id, 'status' => 'CANCELLED'];
    }

    public function reviewPage(string $token, string $origin): string
    {
        if (! $this->activeToken($token)) {
            return $this->resultPage('This request is no longer valid', 'It may have expired, been cancelled, or already been answered.');
        }
        $action = htmlspecialchars(rtrim($origin, '/').'/api/v1/auth/password-change/decision', ENT_QUOTES, 'UTF-8');
        $safeToken = htmlspecialchars($token, ENT_QUOTES, 'UTF-8');

        return '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>CampusGig password change</title></head><body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#17211d"><main style="max-width:520px;margin:60px auto;padding:28px;border:1px solid #dce5e0;border-radius:18px;background:#fff"><h1>Review password change</h1><p>Approve only if you requested this change from the CampusGig mobile app.</p><p>This request expires in 15 minutes.</p><form method="post" action="'.$action.'"><input type="hidden" name="token" value="'.$safeToken.'"><button name="decision" value="CONFIRMED">Confirm password change</button> <button name="decision" value="REJECTED">Reject request</button></form></main></body></html>';
    }

    public function decide(string $token, string $decision): string
    {
        $change = $this->activeToken($token);
        if (! $change) {
            return $this->resultPage('This request is no longer valid', 'It may have expired, been cancelled, or already been answered.');
        }

        if ($decision === 'CONFIRMED') {
            $confirmed = DB::transaction(function () use ($change): bool {
                $count = PasswordChangeRequest::query()->whereKey($change->id)->where('status', 'PENDING')->where('expiresAt', '>', now())->update(['status' => 'CONFIRMED', 'respondedAt' => now()]);
                if ($count !== 1) {
                    return false;
                }
                $user = User::query()->whereKey($change->userId)->lockForUpdate()->firstOrFail();
                $this->sessions->replacePasswordAndRevokeSessions($user, $change->newPasswordHash);

                return true;
            });
            if (! $confirmed) {
                throw $this->error(409, 'Request already handled', 'Conflict');
            }
            $user = User::query()->find($change->userId);
            if ($user) {
                $this->sendPasswordChanged($user->email);
            }

            return $this->resultPage('Password changed successfully', 'You can return to the CampusGig app. It will continue automatically.');
        }

        $change->forceFill(['status' => 'REJECTED', 'respondedAt' => now()])->save();

        return $this->resultPage('Password change rejected', 'Your existing password is unchanged. You can return to the CampusGig app.');
    }

    private function activeToken(string $token): ?PasswordChangeRequest
    {
        if (strlen($token) < 32) {
            return null;
        }

        return PasswordChangeRequest::query()->where('tokenHash', hash('sha256', $token))->where('status', 'PENDING')->where('expiresAt', '>', now())->first();
    }

    private function expireOld(string $userId): void
    {
        PasswordChangeRequest::query()->where('userId', $userId)->where('status', 'PENDING')->where('expiresAt', '<=', now())->update(['status' => 'EXPIRED', 'respondedAt' => now()]);
    }

    private function toStatus(PasswordChangeRequest $change): array
    {
        return ['id' => $change->id, 'status' => $change->status, 'expiresAt' => $change->expiresAt, 'createdAt' => $change->createdAt];
    }

    private function sendPasswordChanged(string $email): void
    {
        try {
            Mail::raw('Your CampusGig password was changed. If this was not you, reset it immediately and contact support.', function ($message) use ($email): void {
                $message->to($email)->subject('Your CampusGig password was changed');
            });
        } catch (Throwable) {
            // The password is already changed; notification failure must not roll it back.
        }
    }

    private function resultPage(string $title, string $body): string
    {
        return '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>'.htmlspecialchars($title).'</title></head><body style="margin:0;background:#0f1713;font-family:Arial,sans-serif;color:#f2f6f3"><main style="max-width:520px;margin:70px auto;padding:30px;border:1px solid #34423a;border-radius:18px;background:#1c2520"><div style="color:#70d0aa;font-weight:800">CAMPUSGIG SECURITY</div><h1>'.htmlspecialchars($title).'</h1><p>'.htmlspecialchars($body).'</p></main></body></html>';
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function error(int $status, string $message, string $title): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $title, 'statusCode' => $status], $status));
    }
}
