<?php

namespace Tests\Unit;

use App\Console\Commands\MigratePostgresToMysql;
use ReflectionMethod;
use Tests\TestCase;

class MigrationCommandTest extends TestCase
{
    public function test_migration_refuses_to_run_without_an_explicit_source_database(): void
    {
        config()->set('database.connections.migration_source.url', null);

        $this->artisan('campusgig:migrate-postgres-to-mysql --execute')
            ->expectsOutput('MIGRATION_SOURCE_DATABASE_URL is required.')
            ->assertFailed();
    }

    public function test_reconciliation_normalizes_cross_database_types_deterministically(): void
    {
        $method = new ReflectionMethod(MigratePostgresToMysql::class, 'canonicalRow');
        $command = app(MigratePostgresToMysql::class);
        $types = [
            'enabled' => 'boolean',
            'createdAt' => 'timestamp with time zone',
            'skills' => 'ARRAY:_text',
            'context' => 'jsonb',
        ];
        $postgres = [
            'enabled' => true,
            'createdAt' => '2026-10-18 14:00:00+00',
            'skills' => '["Design","Editing"]',
            'context' => '{"b":2,"a":1}',
        ];
        $mysql = [
            'enabled' => 1,
            'createdAt' => '2026-10-18 14:00:00.000000',
            'skills' => '["Design", "Editing"]',
            'context' => '{"a":1,"b":2}',
        ];

        $this->assertSame(
            $method->invoke($command, $postgres, $types),
            $method->invoke($command, $mysql, $types),
        );
    }
}
