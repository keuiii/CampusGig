<?php

namespace Tests\Feature;

use Illuminate\Http\Request;
use Illuminate\Routing\RouteCollectionInterface;
use Illuminate\Support\Facades\Route;
use JsonException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Tests\TestCase;

final class NestRouteCompatibilityTest extends TestCase
{
    /** @throws JsonException */
    public function test_every_nestjs_http_route_is_registered_by_laravel(): void
    {
        $contractPath = base_path('tests/Fixtures/nest-route-contract.json');
        $contract = json_decode(
            file_get_contents($contractPath),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertIsArray($contract);
        self::assertGreaterThan(100, count($contract));

        /** @var RouteCollectionInterface $routes */
        $routes = Route::getRoutes();
        $missing = [];
        foreach ($contract as $endpoint) {
            $path = preg_replace(
                '/\{[A-Za-z][A-Za-z0-9_]*\}/',
                '00000000-0000-4000-8000-000000000001',
                $endpoint['path'],
            );
            try {
                $routes->match(Request::create($path, $endpoint['method']));
            } catch (NotFoundHttpException) {
                $missing[] = $endpoint['method'].' '.$endpoint['path'];
            }
        }

        self::assertSame([], $missing, 'Laravel is missing NestJS routes: '.implode(', ', $missing));
    }
}
