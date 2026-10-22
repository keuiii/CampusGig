<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequireMetricsToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = trim((string) config('campusgig.metrics_token'));
        if ($expected === '' && ! app()->isProduction() && $this->isInternal($request->ip())) {
            return $next($request);
        }

        $authorization = (string) $request->header('Authorization', '');
        $supplied = str_starts_with($authorization, 'Bearer ')
            ? substr($authorization, 7)
            : '';

        abort_unless(
            strlen($supplied) === strlen($expected) && hash_equals($expected, $supplied),
            401,
        );

        return $next($request);
    }

    private function isInternal(?string $address): bool
    {
        $normalized = preg_replace('/^::ffff:/', '', $address ?? '') ?? '';

        return $normalized === '::1'
            || str_starts_with($normalized, '127.')
            || str_starts_with($normalized, '10.')
            || str_starts_with($normalized, '192.168.')
            || preg_match('/^172\.(1[6-9]|2\d|3[01])\./', $normalized) === 1;
    }
}
