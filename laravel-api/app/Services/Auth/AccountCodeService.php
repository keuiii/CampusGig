<?php

namespace App\Services\Auth;

use App\Models\AccountCode;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class AccountCodeService
{
    public function issue(string $userId, string $email, string $purpose): string
    {
        $latest = AccountCode::query()
            ->where('userId', $userId)
            ->where('purpose', $purpose)
            ->latest('createdAt')
            ->first();

        if ($latest && $latest->createdAt->gt(now()->subMinute())) {
            throw $this->error(429, 'Please wait one minute before requesting another code');
        }

        $code = (string) random_int(100000, 999999);
        AccountCode::query()->create([
            'id' => (string) Str::uuid(),
            'userId' => $userId,
            'purpose' => $purpose,
            'codeHash' => password_hash($code, PASSWORD_BCRYPT, ['cost' => 10]),
            'expiresAt' => now()->addMinutes(10),
            'attempts' => 0,
        ]);

        if (! $this->exposesDevelopmentCode()) {
            $label = $purpose === 'VERIFY_EMAIL' ? 'email verification' : 'password reset';
            Mail::raw("Your CampusGig {$label} code is {$code}. It expires in 10 minutes.", function ($message) use ($email, $label): void {
                $message->to($email)->subject("CampusGig {$label} code");
            });
        }

        return $code;
    }

    public function validate(string $userId, string $purpose, string $plainCode): AccountCode
    {
        $code = AccountCode::query()
            ->where('userId', $userId)
            ->where('purpose', $purpose)
            ->whereNull('consumedAt')
            ->where('expiresAt', '>', now())
            ->latest('createdAt')
            ->first();

        if (! $code || $code->attempts >= 5) {
            throw $this->error(400, 'Invalid or expired code');
        }
        if (! password_verify($plainCode, $code->codeHash)) {
            $code->increment('attempts');
            throw $this->error(400, 'Invalid or expired code');
        }

        return $code;
    }

    public function exposesDevelopmentCode(): bool
    {
        return ! app()->isProduction() && (bool) config('campusgig.expose_development_codes');
    }

    private function error(int $status, string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => $message,
            'error' => $status === 429 ? 'Too Many Requests' : 'Bad Request',
            'statusCode' => $status,
        ], $status));
    }
}
