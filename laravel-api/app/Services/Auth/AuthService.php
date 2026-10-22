<?php

namespace App\Services\Auth;

use App\Models\SocialAccount;
use App\Models\User;
use App\Models\UserRoleAssignment;
use Illuminate\Database\QueryException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

class AuthService
{
    public function __construct(
        private readonly AccountCodeService $codes,
        private readonly SessionService $sessions,
        private readonly MfaService $mfa,
        private readonly PasswordChangeService $passwordChanges,
        private readonly GoogleIdentityService $google,
    ) {}

    public function register(array $input): array
    {
        $email = $this->normalizeEmail($input['email']);
        try {
            $user = DB::transaction(function () use ($input, $email): User {
                $user = User::query()->create([
                    'email' => $email,
                    'displayName' => trim($input['displayName']),
                    'passwordHash' => password_hash($input['password'], PASSWORD_BCRYPT, ['cost' => 12]),
                    'status' => 'PENDING',
                    'sessionVersion' => 0,
                ]);
                foreach (($input['isStudent'] ?? false) ? ['CLIENT', 'STUDENT'] : ['CLIENT'] as $role) {
                    UserRoleAssignment::query()->create(['userId' => $user->id, 'role' => $role]);
                }

                return $user;
            });
        } catch (QueryException $exception) {
            if (User::query()->where('email', $email)->exists()) {
                throw $this->error(409, 'An account with this email already exists', 'Conflict');
            }
            throw $exception;
        }

        $code = $this->codes->issue($user->id, $user->email, 'VERIFY_EMAIL');

        return [
            'requiresVerification' => true,
            'email' => $user->email,
            ...($this->codes->exposesDevelopmentCode() ? ['developmentCode' => $code] : []),
        ];
    }

    public function login(array $input): array
    {
        $user = User::query()->with('roleAssignments')->where('email', $this->normalizeEmail($input['email']))->first();
        if (! $user || ! password_verify($input['password'], $user->passwordHash)) {
            throw $this->error(401, 'Invalid email or password', 'Unauthorized');
        }
        if (! $user->emailVerifiedAt) {
            throw $this->error(401, 'Verify your email before signing in', 'Unauthorized');
        }
        if (in_array($user->status, ['SUSPENDED', 'DEACTIVATED'], true)) {
            throw $this->error(401, 'This account is not active', 'Unauthorized');
        }

        return $this->createLoginResult($user, $input);
    }

    public function socialLogin(array $input): array
    {
        $identity = $this->google->verify($input['idToken']);
        $linked = SocialAccount::query()->where('provider', 'GOOGLE')->where('providerUserId', $identity['sub'])->first();
        if ($linked) {
            $user = User::query()->with('roleAssignments')->findOrFail($linked->userId);
        } else {
            $user = DB::transaction(function () use ($identity): User {
                $existing = User::query()->with('roleAssignments')->where('email', $identity['email'])->lockForUpdate()->first();
                if ($existing && ! str_ends_with($identity['email'], '@gmail.com') && ! $identity['hd']) {
                    throw $this->error(409, 'For this email address, sign in with your password first. Automatic Google linking is only available for Gmail and Google Workspace accounts.', 'Conflict');
                }
                $user = $existing ?: User::query()->create([
                    'email' => $identity['email'],
                    'displayName' => $identity['name'] ?: explode('@', $identity['email'])[0],
                    'passwordHash' => password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT, ['cost' => 12]),
                    'status' => 'ACTIVE', 'emailVerifiedAt' => now(), 'sessionVersion' => 0,
                ]);
                if (! $existing) {
                    UserRoleAssignment::query()->create(['userId' => $user->id, 'role' => 'CLIENT']);
                }
                if (in_array($user->status, ['SUSPENDED', 'DEACTIVATED'], true)) {
                    throw $this->error(401, 'This account is not active', 'Unauthorized');
                }
                if (! $user->emailVerifiedAt || $user->status === 'PENDING') {
                    $user->forceFill(['emailVerifiedAt' => $user->emailVerifiedAt ?: now(), 'status' => 'ACTIVE'])->save();
                }
                SocialAccount::query()->create([
                    'id' => (string) Str::uuid(), 'userId' => $user->id,
                    'provider' => 'GOOGLE', 'providerUserId' => $identity['sub'], 'providerEmail' => $identity['email'],
                ]);

                return $user->refresh()->load('roleAssignments');
            });
        }
        if (in_array($user->status, ['SUSPENDED', 'DEACTIVATED'], true)) {
            throw $this->error(401, 'This account is not active', 'Unauthorized');
        }

        return $this->createLoginResult($user, $input);
    }

    public function verifyEmail(array $input): array
    {
        $user = User::query()->with('roleAssignments')->where('email', $this->normalizeEmail($input['email']))->first();
        if (! $user) {
            throw $this->error(400, 'Invalid or expired verification code', 'Bad Request');
        }
        if ($user->emailVerifiedAt) {
            return $this->sessions->create($user, $this->sessionContext($input));
        }

        $code = $this->codes->validate($user->id, 'VERIFY_EMAIL', $input['code']);
        DB::transaction(function () use ($code, $user): void {
            $code->forceFill(['consumedAt' => now()])->save();
            $user->forceFill(['emailVerifiedAt' => now(), 'status' => 'ACTIVE'])->save();
        });
        $user->refresh()->load('roleAssignments');

        return $this->sessions->create($user, $this->sessionContext($input));
    }

    public function resendVerification(string $email): array
    {
        $user = User::query()->where('email', $this->normalizeEmail($email))->first();
        if (! $user || $user->emailVerifiedAt) {
            return ['message' => 'If the account needs verification, a new code has been sent.'];
        }
        $code = $this->codes->issue($user->id, $user->email, 'VERIFY_EMAIL');

        return [
            'message' => 'A new verification code has been sent.',
            ...($this->codes->exposesDevelopmentCode() ? ['developmentCode' => $code] : []),
        ];
    }

    public function forgotPassword(string $email): array
    {
        $user = User::query()->where('email', $this->normalizeEmail($email))->first();
        $message = 'If an eligible account exists, a password-reset code has been sent.';
        if (! $user || ! $user->emailVerifiedAt) {
            return ['message' => $message];
        }
        $code = $this->codes->issue($user->id, $user->email, 'RESET_PASSWORD');

        return [
            'message' => $message,
            ...($this->codes->exposesDevelopmentCode() ? ['developmentCode' => $code] : []),
        ];
    }

    public function resetPassword(array $input): array
    {
        $user = User::query()->where('email', $this->normalizeEmail($input['email']))->first();
        if (! $user) {
            throw $this->error(400, 'Invalid or expired reset code', 'Bad Request');
        }
        $code = $this->codes->validate($user->id, 'RESET_PASSWORD', $input['code']);
        if ($user->mfaEnabledAt) {
            if (! isset($input['mfaCode'])) {
                throw $this->error(400, 'Enter your authenticator or recovery code to reset this protected account', 'Bad Request');
            }
            $this->mfa->verifyCurrentFactor($user, $input['mfaCode'], $input['recoveryCode'] ?? false);
        }

        DB::transaction(function () use ($code, $user, $input): void {
            $code->forceFill(['consumedAt' => now()])->save();
            $this->sessions->replacePasswordAndRevokeSessions(
                $user,
                password_hash($input['password'], PASSWORD_BCRYPT, ['cost' => 12]),
            );
        });

        $delivered = false;
        try {
            if (! $this->codes->exposesDevelopmentCode()) {
                Mail::raw('Your CampusGig password was changed. If this was not you, contact support immediately.', function ($message) use ($user): void {
                    $message->to($user->email)->subject('CampusGig password changed');
                });
                $delivered = true;
            }
        } catch (Throwable) {
            $delivered = false;
        }

        return [
            'message' => $delivered
                ? 'Password updated. A confirmation email was sent. You can now sign in.'
                : 'Password updated. You can now sign in.',
            'confirmationEmailSent' => $delivered,
        ];
    }

    public function me(User $user): array
    {
        return $this->sessions->authenticatedUser($user);
    }

    public function verifyMfaChallenge(array $input): array
    {
        $verified = $this->mfa->verifyChallenge($input['challengeToken'], $input['code'], $input['recoveryCode'] ?? false, $input['rememberDevice'] ?? false);

        return [
            ...$this->sessions->create($verified['user'], $this->sessionContext($input)),
            ...(isset($verified['trustedDeviceToken']) ? ['trustedDeviceToken' => $verified['trustedDeviceToken'], 'trustedForDays' => 30] : []),
        ];
    }

    public function mfaStatus(User $user): array
    {
        return [...$this->mfa->status($user), 'trustedDeviceCount' => $this->mfa->trustedDeviceCount($user->id)];
    }

    public function beginMfaSetup(User $user): array
    {
        return $this->mfa->beginSetup($user);
    }

    public function confirmMfaSetup(User $user, string $code): array
    {
        return $this->mfa->confirmSetup($user, $code);
    }

    public function disableMfa(User $user, string $currentPassword, string $code): array
    {
        if (! password_verify($currentPassword, $user->passwordHash)) {
            throw $this->error(401, 'Current password is incorrect', 'Unauthorized');
        }
        $user->loadMissing('roleAssignments');
        if ($user->roleAssignments->pluck('role')->contains(fn (string $role): bool => in_array($role, ['ADMIN', 'SCHOOL_ADMIN'], true))) {
            throw $this->error(400, 'Two-factor authentication is required for administrator accounts', 'Bad Request');
        }
        $this->mfa->verifyCurrentCode($user, $code);

        return $this->mfa->disable($user);
    }

    public function regenerateRecoveryCodes(User $user, string $code): array
    {
        $this->mfa->verifyCurrentCode($user, $code);

        return $this->mfa->regenerateRecoveryCodes($user);
    }

    public function revokeTrustedDevices(User $user): array
    {
        return $this->mfa->revokeTrustedDevices($user->id);
    }

    public function changePassword(User $user, array $input, string $origin): array
    {
        return $this->passwordChanges->request($user, $input, $origin);
    }

    public function pendingPasswordChange(User $user): ?array
    {
        return $this->passwordChanges->pending($user->id);
    }

    public function passwordChangeStatus(User $user, string $id): array
    {
        return $this->passwordChanges->status($user->id, $id);
    }

    public function cancelPasswordChange(User $user, string $id): array
    {
        return $this->passwordChanges->cancel($user->id, $id);
    }

    public function passwordChangeReview(string $token, string $origin): string
    {
        return $this->passwordChanges->reviewPage($token, $origin);
    }

    public function decidePasswordChange(string $token, string $decision): string
    {
        return $this->passwordChanges->decide($token, $decision);
    }

    private function sessionContext(array $input): array
    {
        $clientType = $input['clientType'] ?? 'WEB';

        return [
            'clientType' => $clientType,
            'deviceName' => trim($input['deviceName'] ?? '') ?: ($clientType === 'MOBILE' ? 'Mobile device' : 'Web browser'),
        ];
    }

    private function createLoginResult(User $user, array $input): array
    {
        if ($user->mfaEnabledAt && ! $this->mfa->isTrustedDevice($user->id, $input['trustedDeviceToken'] ?? null)) {
            return ['requiresTwoFactor' => true, 'challengeToken' => $this->mfa->createChallenge($user->id), 'method' => 'AUTHENTICATOR'];
        }

        return $this->sessions->create($user, $this->sessionContext($input));
    }

    private function normalizeEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    private function error(int $status, string $message, string $title): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => $message,
            'error' => $title,
            'statusCode' => $status,
        ], $status));
    }
}
