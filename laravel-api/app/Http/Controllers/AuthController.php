<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Auth\AuthService;
use App\Services\Auth\SessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Cookie;

class AuthController extends Controller
{
    private const REFRESH_COOKIE = 'campusgig_refresh';

    private const TRUSTED_DEVICE_COOKIE = 'campusgig_trusted_device';

    public function __construct(
        private readonly AuthService $auth,
        private readonly SessionService $sessions,
    ) {}

    public function register(Request $request): JsonResponse
    {
        $input = $request->validate([
            'email' => ['required', 'email', 'max:254'],
            'displayName' => ['required', 'string', 'min:2', 'max:80'],
            'password' => ['required', 'string', 'min:8', 'max:72'],
            'isStudent' => ['sometimes', 'boolean'],
        ]);

        return response()->json($this->auth->register($input), 201);
    }

    public function login(Request $request): JsonResponse
    {
        $input = $request->validate($this->sessionRules([
            'email' => ['required', 'email', 'max:254'],
            'password' => ['required', 'string', 'min:8', 'max:72'],
            'trustedDeviceToken' => ['sometimes', 'nullable', 'string', 'min:32', 'max:200'],
        ]));

        if (($input['clientType'] ?? 'WEB') === 'WEB') {
            $input['trustedDeviceToken'] = $request->cookie(self::TRUSTED_DEVICE_COOKIE);
        }

        return $this->deliverSession($this->auth->login($input), $input['clientType'] ?? 'WEB');
    }

    public function socialLogin(Request $request): JsonResponse
    {
        $input = $request->validate($this->sessionRules([
            'provider' => ['required', Rule::in(['GOOGLE'])],
            'idToken' => ['required', 'string', 'min:20'],
            'trustedDeviceToken' => ['sometimes', 'nullable', 'string', 'min:32', 'max:200'],
        ]));
        if (($input['clientType'] ?? 'WEB') === 'WEB') {
            $input['trustedDeviceToken'] = $request->cookie(self::TRUSTED_DEVICE_COOKIE);
        }

        return $this->deliverSession($this->auth->socialLogin($input), $input['clientType'] ?? 'WEB');
    }

    public function verifyEmail(Request $request): JsonResponse
    {
        $input = $request->validate($this->sessionRules([
            'email' => ['required', 'email', 'max:254'],
            'code' => ['required', 'string', 'size:6'],
        ]));

        return $this->deliverSession($this->auth->verifyEmail($input), $input['clientType'] ?? 'WEB');
    }

    public function resendVerification(Request $request): JsonResponse
    {
        $input = $request->validate(['email' => ['required', 'email', 'max:254']]);

        return response()->json($this->auth->resendVerification($input['email']));
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $input = $request->validate(['email' => ['required', 'email', 'max:254']]);

        return response()->json($this->auth->forgotPassword($input['email']));
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $input = $request->validate([
            'email' => ['required', 'email', 'max:254'],
            'code' => ['required', 'string', 'size:6'],
            'password' => ['required', 'string', 'min:8', 'max:72'],
            'mfaCode' => ['sometimes', 'string', 'min:6', 'max:20'],
            'recoveryCode' => ['sometimes', 'boolean'],
        ]);

        return response()->json($this->auth->resetPassword($input));
    }

    public function refresh(Request $request): JsonResponse
    {
        $input = $request->validate(['refreshToken' => ['sometimes', 'nullable', 'string', 'min:32', 'max:500']]);
        $bodyToken = $input['refreshToken'] ?? null;
        $token = $bodyToken ?: $request->cookie(self::REFRESH_COOKIE, '');

        return $this->deliverSession($this->sessions->refresh($token), $bodyToken ? 'MOBILE' : 'WEB');
    }

    public function logout(Request $request): JsonResponse
    {
        $input = $request->validate(['refreshToken' => ['sometimes', 'nullable', 'string', 'min:32', 'max:500']]);
        $result = $this->sessions->revokeByToken(($input['refreshToken'] ?? null) ?: $request->cookie(self::REFRESH_COOKIE));

        return response()->json($result)->withoutCookie($this->forgetRefreshCookie());
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json($this->auth->me($this->user($request)));
    }

    public function sessions(Request $request): JsonResponse
    {
        return response()->json($this->sessions->list($this->user($request)->id, $request->attributes->get('auth.sessionId')));
    }

    public function revokeSession(Request $request, string $id): JsonResponse
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid session id');

        return response()->json($this->sessions->revoke($this->user($request)->id, $id));
    }

    public function logoutAll(Request $request): JsonResponse
    {
        return response()->json($this->sessions->revokeAll($this->user($request)))->withoutCookie($this->forgetRefreshCookie());
    }

    public function verifyMfaChallenge(Request $request): JsonResponse
    {
        $input = $request->validate($this->sessionRules([
            'challengeToken' => ['required', 'string', 'min:32', 'max:200'],
            'code' => ['required', 'string', 'min:6', 'max:20'],
            'recoveryCode' => ['sometimes', 'boolean'],
            'rememberDevice' => ['sometimes', 'boolean'],
        ]));

        return $this->deliverSession($this->auth->verifyMfaChallenge($input), $input['clientType'] ?? 'WEB');
    }

    public function mfaStatus(Request $request): JsonResponse
    {
        return response()->json($this->auth->mfaStatus($this->user($request)));
    }

    public function beginMfaSetup(Request $request): JsonResponse
    {
        return response()->json($this->auth->beginMfaSetup($this->user($request)));
    }

    public function confirmMfaSetup(Request $request): JsonResponse
    {
        $input = $request->validate(['code' => ['required', 'string', 'regex:/^[0-9]{6}$/']]);

        return response()->json($this->auth->confirmMfaSetup($this->user($request), $input['code']));
    }

    public function disableMfa(Request $request): JsonResponse
    {
        $input = $request->validate(['currentPassword' => ['required', 'string', 'min:8'], 'code' => ['required', 'string', 'regex:/^[0-9]{6}$/']]);

        return response()->json($this->auth->disableMfa($this->user($request), $input['currentPassword'], $input['code']));
    }

    public function regenerateRecoveryCodes(Request $request): JsonResponse
    {
        $input = $request->validate(['code' => ['required', 'string', 'size:6']]);

        return response()->json($this->auth->regenerateRecoveryCodes($this->user($request), $input['code']));
    }

    public function revokeTrustedDevices(Request $request): JsonResponse
    {
        return response()->json($this->auth->revokeTrustedDevices($this->user($request)))->withoutCookie($this->forgetTrustedDeviceCookie());
    }

    public function changePassword(Request $request): JsonResponse
    {
        $input = $request->validate([
            'currentPassword' => ['required', 'string', 'min:8', 'max:72'],
            'newPassword' => ['required', 'string', 'min:8', 'max:72'],
            'mfaCode' => ['sometimes', 'string', 'min:6', 'max:20'],
            'recoveryCode' => ['sometimes', 'boolean'],
        ]);

        return response()->json($this->auth->changePassword($this->user($request), $input, $request->getSchemeAndHttpHost()));
    }

    public function pendingPasswordChange(Request $request): JsonResponse
    {
        return response()->json($this->auth->pendingPasswordChange($this->user($request)));
    }

    public function passwordChangeStatus(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->auth->passwordChangeStatus($this->user($request), $id));
    }

    public function cancelPasswordChange(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->auth->cancelPasswordChange($this->user($request), $id));
    }

    public function passwordChangeReview(Request $request): Response
    {
        $token = $request->validate(['token' => ['required', 'string', 'min:32', 'max:200']])['token'];

        return response($this->auth->passwordChangeReview($token, $request->getSchemeAndHttpHost()))->header('Content-Type', 'text/html; charset=UTF-8');
    }

    public function decidePasswordChange(Request $request): Response
    {
        $input = $request->validate(['token' => ['required', 'string', 'min:32', 'max:200'], 'decision' => ['required', Rule::in(['CONFIRMED', 'REJECTED'])]]);

        return response($this->auth->decidePasswordChange($input['token'], $input['decision']))->header('Content-Type', 'text/html; charset=UTF-8');
    }

    private function deliverSession(array $result, string $clientType): JsonResponse
    {
        if ($result['requiresTwoFactor'] ?? false) {
            return response()->json($result)->withoutCookie($this->forgetTrustedDeviceCookie());
        }
        if ($clientType === 'MOBILE') {
            return response()->json($result);
        }
        $refreshToken = $result['refreshToken'];
        $maxAge = $result['refreshExpiresIn'];
        unset($result['refreshToken']);

        $response = response()->json($result)->cookie(new Cookie(
            self::REFRESH_COOKIE,
            $refreshToken,
            now()->addSeconds($maxAge),
            '/api/v1/auth',
            null,
            app()->isProduction(),
            true,
            false,
            Cookie::SAMESITE_STRICT,
        ));
        if (isset($result['trustedDeviceToken'])) {
            $trustedToken = $result['trustedDeviceToken'];
            unset($result['trustedDeviceToken'], $result['trustedForDays']);
            $response->setData($result);
            $response->cookie(new Cookie(self::TRUSTED_DEVICE_COOKIE, $trustedToken, now()->addDays(30), '/api/v1/auth', null, app()->isProduction(), true, false, Cookie::SAMESITE_STRICT));
        }

        return $response;
    }

    private function forgetRefreshCookie(): Cookie
    {
        return Cookie::create(self::REFRESH_COOKIE)->withValue('')->withExpires(1)->withPath('/api/v1/auth')->withSecure(app()->isProduction())->withHttpOnly(true)->withSameSite(Cookie::SAMESITE_STRICT);
    }

    private function forgetTrustedDeviceCookie(): Cookie
    {
        return Cookie::create(self::TRUSTED_DEVICE_COOKIE)->withValue('')->withExpires(1)->withPath('/api/v1/auth')->withSecure(app()->isProduction())->withHttpOnly(true)->withSameSite(Cookie::SAMESITE_STRICT);
    }

    private function sessionRules(array $rules): array
    {
        return $rules + [
            'clientType' => ['sometimes', Rule::in(['WEB', 'MOBILE'])],
            'deviceName' => ['sometimes', 'string', 'min:2', 'max:100'],
        ];
    }

    private function user(Request $request): User
    {
        return $request->attributes->get('auth.user');
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid id');
    }
}
