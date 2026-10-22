<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $driver = config('campusgig.malware_scanner.driver');
        if (! in_array($driver, ['disabled', 'clamav', 'phpmussel'], true)) {
            throw new \RuntimeException('MALWARE_SCANNER_DRIVER must be disabled, clamav, or phpmussel.');
        }
        if ($this->app->environment('production') && ! in_array($driver, ['clamav', 'phpmussel'], true)) {
            throw new \RuntimeException('Production requires an enabled malware scanner.');
        }
        $port = config('campusgig.malware_scanner.port');
        if (! is_int($port) || $port < 1 || $port > 65535) {
            throw new \RuntimeException('CLAMAV_PORT must be between 1 and 65535.');
        }
        $timeout = config('campusgig.malware_scanner.timeout_seconds');
        if (! is_float($timeout) && ! is_int($timeout) || $timeout < 1 || $timeout > 120) {
            throw new \RuntimeException('CLAMAV_TIMEOUT_MS must be between 1000 and 120000.');
        }
        $signatureMaxAgeDays = config('campusgig.malware_scanner.phpmussel.signature_max_age_days');
        if (! is_int($signatureMaxAgeDays) || $signatureMaxAgeDays < 1 || $signatureMaxAgeDays > 30) {
            throw new \RuntimeException('PHPMUSSEL_SIGNATURE_MAX_AGE_DAYS must be between 1 and 30.');
        }
        $mode = config('campusgig.paymongo.mode');
        if (! in_array($mode, ['test', 'live'], true)) {
            throw new \RuntimeException('PAYMONGO_MODE must be test or live.');
        }
        if ($this->app->environment('production')) {
            if (config('app.debug')) {
                throw new \RuntimeException('APP_DEBUG must be false in production.');
            }
            $this->requireSecret('APP_KEY', (string) config('app.key'), 32);
            $this->requireSecret('JWT_SECRET', (string) config('campusgig.jwt_secret'), 32);
            $this->requireSecret('MFA_ENCRYPTION_KEY', (string) config('campusgig.mfa_encryption_key'), 32);
            $this->requireSecret(
                'PAYOUT_DESTINATION_ENCRYPTION_KEY',
                (string) config('security.payout_destination_encryption_key'),
                32,
            );
            $this->requireSecret('METRICS_TOKEN', (string) config('campusgig.metrics_token'), 32);
            $this->requireHttpsUrl('APP_URL', (string) config('app.url'));
            $this->requireHttpsUrl(
                'EMAIL_ACTION_BASE_URL',
                (string) config('campusgig.email_action_base_url'),
            );
            foreach (config('cors.allowed_origins', []) as $origin) {
                $this->requireHttpsUrl('WEB_ORIGIN', (string) $origin);
            }
            if (config('cors.allowed_origins', []) === []) {
                throw new \RuntimeException('Production requires WEB_ORIGIN.');
            }
            if (in_array(config('mail.default'), ['array', 'log'], true)) {
                throw new \RuntimeException('Production requires a real mail transport.');
            }
            if (filter_var(config('campusgig.expose_development_codes'), FILTER_VALIDATE_BOOL)) {
                throw new \RuntimeException('EXPOSE_DEVELOPMENT_AUTH_CODES must be false in production.');
            }
            if ($mode !== 'live') {
                throw new \RuntimeException('Production requires PAYMONGO_MODE=live.');
            }
            $key = trim((string) config('campusgig.paymongo.secret_key'));
            if (! str_starts_with($key, 'sk_live_')) {
                throw new \RuntimeException('Production requires a PayMongo live secret key.');
            }
            if (strlen(trim((string) config('campusgig.paymongo.webhook_secret'))) < 12) {
                throw new \RuntimeException('Production requires PAYMONGO_WEBHOOK_SECRET.');
            }
            foreach (['success_url', 'cancel_url', 'mobile_return_origin'] as $urlKey) {
                $this->requireHttpsUrl(
                    "PAYMONGO_{$urlKey}",
                    (string) config("campusgig.paymongo.{$urlKey}"),
                );
            }
        }
    }

    private function requireSecret(string $name, string $value, int $minimumLength): void
    {
        if (strlen(trim($value)) < $minimumLength) {
            throw new \RuntimeException("Production requires {$name} with at least {$minimumLength} characters.");
        }
    }

    private function requireHttpsUrl(string $name, string $value): void
    {
        $url = parse_url($value);
        if (($url['scheme'] ?? null) !== 'https' || empty($url['host'])) {
            throw new \RuntimeException("Production requires {$name} to be an absolute HTTPS URL.");
        }
    }
}
