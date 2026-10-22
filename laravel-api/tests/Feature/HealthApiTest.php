<?php

namespace Tests\Feature;

use Tests\TestCase;

final class HealthApiTest extends TestCase
{
    public function test_health_endpoint_preserves_the_existing_api_contract(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response
            ->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('service', 'campusgig-api')
            ->assertJsonStructure(['timestamp'])
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('X-Frame-Options', 'DENY');
    }

    public function test_readiness_checks_the_database_private_storage_and_upload_scanner(): void
    {
        $this->getJson('/api/v1/health/ready')
            ->assertOk()
            ->assertExactJson(['status' => 'ready']);
    }

    public function test_unknown_api_routes_use_the_existing_error_envelope(): void
    {
        $this->getJson('/api/v1/not-a-route')
            ->assertNotFound()
            ->assertJsonPath('error', 'Not Found')
            ->assertJsonPath('statusCode', 404)
            ->assertJsonStructure(['message']);
    }

    public function test_metrics_are_private_and_preserve_the_prometheus_contract(): void
    {
        config(['campusgig.metrics_token' => 'testing-metrics-token-32-characters']);

        $this->get('/api/v1/metrics')->assertUnauthorized();

        $response = $this->withToken('testing-metrics-token-32-characters')
            ->get('/api/v1/metrics');

        $response
            ->assertOk()
            ->assertSee('campusgig_api_info{runtime="laravel"} 1', false)
            ->assertSee('campusgig_dependency_up{dependency="database"} 1', false)
            ->assertSee('campusgig_dependency_up{dependency="storage"} 1', false)
            ->assertSee('campusgig_dependency_up{dependency="malware_scanner"} 1', false);
        self::assertStringContainsString(
            'no-store',
            (string) $response->headers->get('Cache-Control'),
        );
        self::assertStringStartsWith(
            'text/plain; version=0.0.4',
            (string) $response->headers->get('Content-Type'),
        );
    }
}
