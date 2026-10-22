<?php

use App\Http\Middleware\AddSecurityHeaders;
use App\Http\Middleware\AuthenticateAccessToken;
use App\Http\Middleware\RequireMetricsToken;
use App\Http\Middleware\RequireRole;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        apiPrefix: 'api/v1',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustProxies(at: '*');
        $middleware->append(AddSecurityHeaders::class);
        $middleware->alias([
            'access.token' => AuthenticateAccessToken::class,
            'metrics.access' => RequireMetricsToken::class,
            'role' => RequireRole::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request): bool => $request->is('api/*') || $request->expectsJson(),
        );

        $exceptions->render(function (ValidationException $exception, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'message' => collect($exception->errors())->flatten()->values()->all(),
                'error' => 'Bad Request',
                'statusCode' => 400,
            ], 400);
        });

        $exceptions->respond(function ($response, Throwable $exception, Request $request) {
            if (! $request->is('api/*') || $exception instanceof ValidationException) {
                return $response;
            }

            $status = $exception instanceof HttpExceptionInterface
                ? $exception->getStatusCode()
                : $response->getStatusCode();

            if ($status < 400) {
                return $response;
            }

            $titles = [
                400 => 'Bad Request',
                401 => 'Unauthorized',
                403 => 'Forbidden',
                404 => 'Not Found',
                405 => 'Method Not Allowed',
                409 => 'Conflict',
                422 => 'Unprocessable Entity',
                429 => 'Too Many Requests',
                500 => 'Internal Server Error',
                502 => 'Bad Gateway',
                503 => 'Service Unavailable',
            ];
            $message = $exception instanceof HttpExceptionInterface
                ? trim($exception->getMessage())
                : '';

            if ($message === '' || ($status >= 500 && ! app()->hasDebugModeEnabled())) {
                $message = $titles[$status] ?? 'Request failed';
            }

            return response()->json([
                'message' => $message,
                'error' => $titles[$status] ?? 'Request Failed',
                'statusCode' => $status,
            ], $status, $response->headers->all());
        });
    })->create();
