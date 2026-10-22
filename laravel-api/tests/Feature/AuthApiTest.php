<?php

namespace Tests\Feature;

use App\Models\PasswordChangeRequest;
use App\Models\User;
use App\Models\UserRoleAssignment;
use Firebase\JWT\JWT;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

final class AuthApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'campusgig.jwt_secret' => 'test-only-secret-with-at-least-thirty-two-characters',
            'campusgig.expose_development_codes' => true,
            'campusgig.access_token_ttl_seconds' => 900,
            'campusgig.refresh_token_idle_days' => 7,
            'campusgig.refresh_token_absolute_days' => 30,
            'campusgig.refresh_token_replay_grace_seconds' => 15,
        ]);

        Schema::create('User', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('email')->unique();
            $table->string('passwordHash');
            $table->string('displayName');
            $table->string('avatarPath')->nullable();
            $table->string('status')->default('PENDING');
            $table->timestamp('lastSeenAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
            $table->timestamp('emailVerifiedAt')->nullable();
            $table->timestamp('mfaEnabledAt')->nullable();
            $table->text('mfaSecretCipher')->nullable();
            $table->text('mfaPendingSecretCipher')->nullable();
            $table->integer('mfaLastUsedStep')->nullable();
            $table->integer('sessionVersion')->default(0);
        });
        Schema::create('UserRoleAssignment', function (Blueprint $table): void {
            $table->uuid('userId');
            $table->string('role');
            $table->timestamp('createdAt');
            $table->primary(['userId', 'role']);
        });
        Schema::create('AuthSession', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('clientType');
            $table->string('deviceName');
            $table->integer('sessionVersion');
            $table->timestamp('expiresAt');
            $table->timestamp('lastUsedAt');
            $table->timestamp('revokedAt')->nullable();
            $table->string('revokedReason')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('RefreshToken', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('sessionId');
            $table->string('tokenHash')->unique();
            $table->timestamp('expiresAt');
            $table->timestamp('usedAt')->nullable();
            $table->timestamp('revokedAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('AccountCode', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('purpose');
            $table->string('codeHash');
            $table->timestamp('expiresAt');
            $table->integer('attempts')->default(0);
            $table->timestamp('consumedAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('MfaRecoveryCode', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('codeHash');
            $table->timestamp('usedAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('MfaChallenge', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('tokenHash')->unique();
            $table->integer('attempts')->default(0);
            $table->timestamp('expiresAt');
            $table->timestamp('consumedAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('TrustedDevice', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('tokenHash')->unique();
            $table->timestamp('expiresAt');
            $table->timestamp('lastUsedAt');
            $table->timestamp('revokedAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('PasswordChangeRequest', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('newPasswordHash');
            $table->string('tokenHash')->unique();
            $table->string('status')->default('PENDING');
            $table->timestamp('expiresAt');
            $table->timestamp('respondedAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('SocialAccount', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('provider');
            $table->string('providerUserId');
            $table->string('providerEmail')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
            $table->unique(['provider', 'providerUserId']);
            $table->unique(['userId', 'provider']);
        });
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('SocialAccount');
        Schema::dropIfExists('PasswordChangeRequest');
        Schema::dropIfExists('TrustedDevice');
        Schema::dropIfExists('MfaChallenge');
        Schema::dropIfExists('MfaRecoveryCode');
        Schema::dropIfExists('AccountCode');
        Schema::dropIfExists('RefreshToken');
        Schema::dropIfExists('AuthSession');
        Schema::dropIfExists('UserRoleAssignment');
        Schema::dropIfExists('User');
        parent::tearDown();
    }

    public function test_mobile_registration_verification_refresh_and_authenticated_user_contract(): void
    {
        $register = $this->postJson('/api/v1/auth/register', [
            'email' => ' Student@Example.com ',
            'displayName' => 'Campus Student',
            'password' => 'strong-password',
            'isStudent' => true,
        ])->assertCreated()
            ->assertJsonPath('requiresVerification', true)
            ->assertJsonPath('email', 'student@example.com')
            ->assertJsonStructure(['developmentCode']);

        $session = $this->postJson('/api/v1/auth/verify-email', [
            'email' => 'student@example.com',
            'code' => $register->json('developmentCode'),
            'clientType' => 'MOBILE',
            'deviceName' => "Test phone\nspoof",
        ])->assertOk()
            ->assertJsonPath('tokenType', 'Bearer')
            ->assertJsonPath('user.status', 'ACTIVE')
            ->assertJsonPath('user.roles.0', 'CLIENT')
            ->assertJsonPath('user.roles.1', 'STUDENT')
            ->assertJsonStructure(['accessToken', 'refreshToken', 'refreshExpiresIn', 'expiresIn'])
            ->json();

        $this->assertIsInt($session['refreshExpiresIn']);
        $this->assertGreaterThan(0, $session['refreshExpiresIn']);

        $this->withToken($session['accessToken'])->getJson('/api/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('email', 'student@example.com')
            ->assertJsonPath('hasAvatar', false);

        $rotated = $this->postJson('/api/v1/auth/refresh', [
            'refreshToken' => $session['refreshToken'],
        ])->assertOk()->json();

        $this->assertNotSame($session['refreshToken'], $rotated['refreshToken']);
        $this->postJson('/api/v1/auth/refresh', [
            'refreshToken' => $session['refreshToken'],
        ])->assertOk()->assertJsonPath('refreshToken', $rotated['refreshToken']);
    }

    public function test_login_rejects_unverified_accounts_and_web_session_uses_cookie(): void
    {
        $registration = $this->postJson('/api/v1/auth/register', [
            'email' => 'client@example.com',
            'displayName' => 'Client User',
            'password' => 'strong-password',
        ])->assertCreated();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'client@example.com',
            'password' => 'strong-password',
        ])->assertUnauthorized()->assertJsonPath('message', 'Verify your email before signing in');

        $this->postJson('/api/v1/auth/verify-email', [
            'email' => 'client@example.com',
            'code' => $registration->json('developmentCode'),
            'clientType' => 'WEB',
        ])->assertOk()
            ->assertCookie('campusgig_refresh')
            ->assertJsonMissingPath('refreshToken');
    }

    public function test_validation_and_authentication_errors_keep_the_nestjs_envelope(): void
    {
        $this->postJson('/api/v1/auth/register', [])
            ->assertBadRequest()
            ->assertJsonPath('error', 'Bad Request')
            ->assertJsonPath('statusCode', 400);

        $this->getJson('/api/v1/auth/me')
            ->assertUnauthorized()
            ->assertJsonPath('error', 'Unauthorized')
            ->assertJsonPath('statusCode', 401);
    }

    public function test_existing_bcryptjs_password_hashes_remain_login_compatible(): void
    {
        $user = User::query()->create([
            'email' => 'existing@example.com',
            'displayName' => 'Existing User',
            'passwordHash' => '$2b$12$2Bk78wjo2p78LjGe4UzeKuEjlal61crEpKbzTgEpY431ZFrC.tM2K',
            'status' => 'ACTIVE',
            'emailVerifiedAt' => now(),
            'sessionVersion' => 0,
        ]);
        UserRoleAssignment::query()->create(['userId' => $user->id, 'role' => 'CLIENT']);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'existing@example.com',
            'password' => 'interop-password',
            'clientType' => 'MOBILE',
            'trustedDeviceToken' => null,
        ])->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonStructure(['accessToken', 'refreshToken']);
    }

    public function test_password_reset_revokes_existing_sessions(): void
    {
        $registration = $this->postJson('/api/v1/auth/register', [
            'email' => 'reset@example.com',
            'displayName' => 'Reset User',
            'password' => 'old-password',
        ]);
        $session = $this->postJson('/api/v1/auth/verify-email', [
            'email' => 'reset@example.com',
            'code' => $registration->json('developmentCode'),
            'clientType' => 'MOBILE',
        ])->json();
        $forgot = $this->postJson('/api/v1/auth/forgot-password', [
            'email' => 'reset@example.com',
        ])->assertOk()->assertJsonStructure(['developmentCode']);

        $this->postJson('/api/v1/auth/reset-password', [
            'email' => 'reset@example.com',
            'code' => $forgot->json('developmentCode'),
            'password' => 'new-password',
        ])->assertOk()->assertJsonPath('confirmationEmailSent', false);

        $this->withToken($session['accessToken'])->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/refresh', ['refreshToken' => $session['refreshToken']])->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', [
            'email' => 'reset@example.com',
            'password' => 'new-password',
            'clientType' => 'MOBILE',
        ])->assertOk();
    }

    public function test_mfa_setup_recovery_challenge_and_trusted_device_flow(): void
    {
        $registration = $this->postJson('/api/v1/auth/register', [
            'email' => 'mfa@example.com', 'displayName' => 'MFA User', 'password' => 'strong-password',
        ]);
        $session = $this->postJson('/api/v1/auth/verify-email', [
            'email' => 'mfa@example.com', 'code' => $registration->json('developmentCode'), 'clientType' => 'MOBILE',
        ])->json();

        $setup = $this->withToken($session['accessToken'])->postJson('/api/v1/auth/mfa/setup')
            ->assertOk()->assertJsonStructure(['secret', 'otpauthUri', 'qrCodeDataUrl']);
        $confirmed = $this->withToken($session['accessToken'])->postJson('/api/v1/auth/mfa/setup/confirm', [
            'code' => $this->totp($setup->json('secret')),
        ])->assertOk()->assertJsonCount(10, 'recoveryCodes');

        $challenge = $this->postJson('/api/v1/auth/login', [
            'email' => 'mfa@example.com', 'password' => 'strong-password', 'clientType' => 'MOBILE',
        ])->assertOk()->assertJsonPath('requiresTwoFactor', true)->json();
        $verified = $this->postJson('/api/v1/auth/mfa/challenge', [
            'challengeToken' => $challenge['challengeToken'],
            'code' => $confirmed->json('recoveryCodes.0'),
            'recoveryCode' => true,
            'rememberDevice' => true,
            'clientType' => 'MOBILE',
        ])->assertOk()->assertJsonStructure(['accessToken', 'refreshToken', 'trustedDeviceToken'])->json();

        $this->postJson('/api/v1/auth/login', [
            'email' => 'mfa@example.com', 'password' => 'strong-password', 'clientType' => 'MOBILE',
            'trustedDeviceToken' => $verified['trustedDeviceToken'],
        ])->assertOk()->assertJsonStructure(['accessToken', 'refreshToken'])->assertJsonMissingPath('requiresTwoFactor');

        $limited = $this->postJson('/api/v1/auth/login', [
            'email' => 'mfa@example.com', 'password' => 'strong-password', 'clientType' => 'MOBILE',
        ])->json();
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/v1/auth/mfa/challenge', [
                'challengeToken' => $limited['challengeToken'], 'code' => 'WRONG-CODE',
                'recoveryCode' => true, 'clientType' => 'MOBILE',
            ])->assertUnauthorized();
        }
        $this->postJson('/api/v1/auth/mfa/challenge', [
            'challengeToken' => $limited['challengeToken'], 'code' => $confirmed->json('recoveryCodes.1'),
            'recoveryCode' => true, 'clientType' => 'MOBILE',
        ])->assertUnauthorized()->assertJsonPath('message', 'Invalid or expired sign-in challenge');
    }

    public function test_email_confirmed_password_change_status_cancel_and_decision_flow(): void
    {
        $registration = $this->postJson('/api/v1/auth/register', [
            'email' => 'change@example.com', 'displayName' => 'Change User', 'password' => 'old-password',
        ]);
        $session = $this->postJson('/api/v1/auth/verify-email', [
            'email' => 'change@example.com', 'code' => $registration->json('developmentCode'), 'clientType' => 'MOBILE',
        ])->json();

        $requested = $this->withToken($session['accessToken'])->postJson('/api/v1/auth/change-password', [
            'currentPassword' => 'old-password', 'newPassword' => 'cancelled-password',
        ])->assertOk()->assertJsonPath('status', 'PENDING')->json();
        $this->withToken($session['accessToken'])->getJson('/api/v1/auth/password-change/pending')
            ->assertOk()->assertJsonPath('id', $requested['id']);
        $this->withToken($session['accessToken'])->getJson("/api/v1/auth/password-change/{$requested['id']}/status")
            ->assertOk()->assertJsonPath('status', 'PENDING');
        $this->withToken($session['accessToken'])->postJson("/api/v1/auth/password-change/{$requested['id']}/cancel")
            ->assertOk()->assertJsonPath('status', 'CANCELLED');

        $user = User::query()->where('email', 'change@example.com')->firstOrFail();
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        PasswordChangeRequest::query()->create([
            'id' => (string) Str::uuid(), 'userId' => $user->id,
            'newPasswordHash' => password_hash('confirmed-password', PASSWORD_BCRYPT, ['cost' => 4]),
            'tokenHash' => hash('sha256', $token), 'status' => 'PENDING', 'expiresAt' => now()->addMinutes(15),
        ]);
        $this->get('/api/v1/auth/password-change/review?token='.rawurlencode($token))
            ->assertOk()->assertSee('Review password change');
        $this->post('/api/v1/auth/password-change/decision', ['token' => $token, 'decision' => 'CONFIRMED'])
            ->assertOk()->assertSee('Password changed successfully');

        $this->withToken($session['accessToken'])->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', [
            'email' => 'change@example.com', 'password' => 'confirmed-password', 'clientType' => 'MOBILE',
        ])->assertOk();
    }

    public function test_google_social_login_validates_signature_audience_and_reuses_linked_account(): void
    {
        config(['campusgig.google_client_ids' => ['campusgig-test-client']]);
        Cache::forget('google-oidc-jwks');
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $this->assertNotFalse($key);
        openssl_pkey_export($key, $privateKey);
        $details = openssl_pkey_get_details($key);
        $this->assertIsArray($details);
        Http::fake(['www.googleapis.com/oauth2/v3/certs' => Http::response(['keys' => [[
            'kty' => 'RSA', 'kid' => 'test-key', 'use' => 'sig', 'alg' => 'RS256',
            'n' => $this->base64Url($details['rsa']['n']), 'e' => $this->base64Url($details['rsa']['e']),
        ]]], 200)]);
        $token = JWT::encode([
            'iss' => 'https://accounts.google.com', 'aud' => 'campusgig-test-client',
            'sub' => 'google-user-123', 'email' => 'social.user@gmail.com',
            'email_verified' => true, 'name' => 'Social User', 'iat' => time(), 'exp' => time() + 300,
        ], $privateKey, 'RS256', 'test-key');

        $first = $this->postJson('/api/v1/auth/social', [
            'provider' => 'GOOGLE', 'idToken' => $token, 'clientType' => 'MOBILE',
            'trustedDeviceToken' => null,
        ])->assertOk()->assertJsonPath('user.email', 'social.user@gmail.com')->json();
        $second = $this->postJson('/api/v1/auth/social', [
            'provider' => 'GOOGLE', 'idToken' => $token, 'clientType' => 'MOBILE',
        ])->assertOk()->json();

        $this->assertSame($first['user']['id'], $second['user']['id']);
        $this->assertDatabaseCount('User', 1);
        $this->assertDatabaseCount('SocialAccount', 1);

        $badAudience = JWT::encode([
            'iss' => 'https://accounts.google.com', 'aud' => 'wrong-client', 'sub' => 'bad',
            'email' => 'bad@gmail.com', 'email_verified' => true, 'iat' => time(), 'exp' => time() + 300,
        ], $privateKey, 'RS256', 'test-key');
        $this->postJson('/api/v1/auth/social', [
            'provider' => 'GOOGLE', 'idToken' => $badAudience, 'clientType' => 'MOBILE',
        ])->assertUnauthorized();
    }

    public function test_verified_active_account_can_be_promoted_to_admin_and_existing_sessions_are_revoked(): void
    {
        $user = User::query()->create([
            'email' => 'owner@example.com',
            'displayName' => 'Platform Owner',
            'passwordHash' => password_hash('strong-password', PASSWORD_BCRYPT, ['cost' => 4]),
            'status' => 'ACTIVE',
            'emailVerifiedAt' => now(),
            'sessionVersion' => 0,
        ]);
        UserRoleAssignment::query()->create(['userId' => $user->id, 'role' => 'CLIENT']);
        $sessionId = (string) Str::uuid();
        DB::table('AuthSession')->insert([
            'id' => $sessionId,
            'userId' => $user->id,
            'clientType' => 'WEB',
            'deviceName' => 'Existing browser',
            'sessionVersion' => 0,
            'expiresAt' => now()->addDay(),
            'lastUsedAt' => now(),
            'createdAt' => now(),
        ]);

        $this->artisan('campusgig:admin:promote', ['email' => ' OWNER@example.com '])
            ->expectsOutput('Administrator role granted. Existing sessions were revoked; sign in again and enable two-factor authentication.')
            ->assertSuccessful();

        $this->assertDatabaseHas('UserRoleAssignment', ['userId' => $user->id, 'role' => 'ADMIN']);
        $this->assertDatabaseHas('AuthSession', ['id' => $sessionId, 'revokedReason' => 'LOGOUT_ALL']);
        $this->assertSame(1, $user->refresh()->sessionVersion);

        $this->artisan('campusgig:admin:promote', ['email' => 'owner@example.com'])
            ->expectsOutput('This account is already a platform administrator.')
            ->assertSuccessful();
    }

    private function totp(string $secret): string
    {
        $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        $bits = '';
        foreach (str_split(strtoupper($secret)) as $char) {
            $bits .= str_pad(decbin((int) strpos($alphabet, $char)), 5, '0', STR_PAD_LEFT);
        }
        $key = '';
        foreach (str_split($bits, 8) as $chunk) {
            if (strlen($chunk) === 8) {
                $key .= chr(bindec($chunk));
            }
        }
        $hash = hash_hmac('sha1', pack('N2', 0, intdiv(time(), 30)), $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24) | ((ord($hash[$offset + 1]) & 0xFF) << 16) | ((ord($hash[$offset + 2]) & 0xFF) << 8) | (ord($hash[$offset + 3]) & 0xFF);

        return str_pad((string) ($binary % 1000000), 6, '0', STR_PAD_LEFT);
    }

    private function base64Url(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}
