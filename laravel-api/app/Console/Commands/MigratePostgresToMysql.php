<?php

namespace App\Console\Commands;

use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class MigratePostgresToMysql extends Command
{
    private const TARGET_ONLY_TABLES = [
        'cache',
        'cache_locks',
        'failed_jobs',
        'job_batches',
        'jobs',
        'migrations',
    ];

    protected $signature = 'campusgig:migrate-postgres-to-mysql
        {--execute : Copy data after all safety checks pass}
        {--chunk=250 : Insert batch size from 1 to 1000}
        {--report= : Report filename under storage/app/migration-reports}';

    protected $description = 'Copy an immutable PostgreSQL snapshot into an empty MySQL schema and reconcile every table';

    public function handle(): int
    {
        try {
            $chunkSize = filter_var($this->option('chunk'), FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1, 'max_range' => 1000],
            ]);
            if ($chunkSize === false) {
                throw new RuntimeException('The chunk option must be an integer between 1 and 1000.');
            }
            if (! config('database.connections.migration_source.url')) {
                throw new RuntimeException('MIGRATION_SOURCE_DATABASE_URL is required.');
            }
            if (! in_array(DB::getDefaultConnection(), ['mysql', 'mariadb'], true)) {
                throw new RuntimeException('The default target connection must be MySQL or MariaDB.');
            }

            $source = DB::connection('migration_source');
            $target = DB::connection();
            $source->getPdo();
            $target->getPdo();
            $tables = $this->assertCompatibleSchemas($source, $target);
            $sourceCounts = $this->counts($source, $tables);
            $targetCounts = $this->counts($target, $tables);
            $nonEmpty = array_filter($targetCounts, fn (int $count): bool => $count > 0);
            $report = [
                'generatedAt' => now()->utc()->toISOString(),
                'mode' => $this->option('execute') ? 'execute' : 'preflight',
                'status' => 'preflight_passed',
                'tables' => count($tables),
                'sourceRows' => array_sum($sourceCounts),
                'sourceCounts' => $sourceCounts,
                'targetCountsBefore' => $targetCounts,
            ];

            if (! $this->option('execute')) {
                $this->writeReport($report);
                $this->info('Preflight passed. No data was changed. Rerun with --execute against an empty target.');

                return self::SUCCESS;
            }
            if ($nonEmpty !== []) {
                throw new RuntimeException('The target is not empty: '.implode(', ', array_keys($nonEmpty)));
            }

            [$sourceHashes, $targetCountsAfter, $targetHashes] = $this->copyAndReconcile(
                $source,
                $target,
                $tables,
                $sourceCounts,
                $chunkSize,
            );
            $report['status'] = 'reconciled';
            $report['targetCountsAfter'] = $targetCountsAfter;
            $report['sourceHashes'] = $sourceHashes;
            $report['targetHashes'] = $targetHashes;
            $report['completedAt'] = now()->utc()->toISOString();
            $path = $this->writeReport($report);
            $this->info("Migration reconciled successfully. Report: {$path}");

            return self::SUCCESS;
        } catch (Throwable $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        } finally {
            DB::purge('migration_source');
        }
    }

    private function copyAndReconcile(
        Connection $source,
        Connection $target,
        array $tables,
        array $sourceCounts,
        int $chunkSize,
    ): array {
        $sourceHashes = [];
        $targetHashes = [];
        $targetCounts = [];
        $target->beginTransaction();
        $target->statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            foreach ($tables as $table) {
                $sourceColumns = $this->sourceColumns($source, $table);
                $targetColumns = $this->targetColumns($target, $table);
                $sourceColumnNames = array_keys($sourceColumns);
                $targetColumnNames = array_keys($targetColumns);
                sort($sourceColumnNames);
                sort($targetColumnNames);
                if ($sourceColumnNames !== $targetColumnNames) {
                    throw new RuntimeException("Column mismatch for {$table}.");
                }
                $selects = [];
                foreach ($sourceColumns as $column => $type) {
                    $quoted = '"'.str_replace('"', '""', $column).'"';
                    $selects[] = str_starts_with($type, 'ARRAY:')
                        ? DB::raw("to_json({$quoted})::text AS {$quoted}")
                        : $column;
                }
                $primaryKey = $this->primaryKey($target, $table);
                $query = $source->table($table)->select($selects);
                foreach ($primaryKey as $column) {
                    $query->orderBy($column);
                }
                $hash = hash_init('sha256');
                $batch = [];
                foreach ($query->cursor() as $row) {
                    $data = (array) $row;
                    foreach ($sourceColumns as $column => $type) {
                        if (str_starts_with($type, 'ARRAY:') && $data[$column] === null) {
                            $data[$column] = '[]';
                        }
                    }
                    hash_update($hash, $this->canonicalRow($data, $sourceColumns));
                    $batch[] = $data;
                    if (count($batch) >= $chunkSize) {
                        $target->table($table)->insert($batch);
                        $batch = [];
                    }
                }
                if ($batch !== []) {
                    $target->table($table)->insert($batch);
                }
                $sourceHashes[$table] = hash_final($hash);
            }

            $this->assertNoOrphans($target);
            $targetCounts = $this->counts($target, $tables);
            foreach ($tables as $table) {
                if ($targetCounts[$table] !== $sourceCounts[$table]) {
                    throw new RuntimeException("Row-count mismatch for {$table}.");
                }
                $types = $this->sourceColumns($source, $table);
                $query = $target->table($table);
                foreach ($this->primaryKey($target, $table) as $column) {
                    $query->orderBy($column);
                }
                $hash = hash_init('sha256');
                foreach ($query->cursor() as $row) {
                    hash_update($hash, $this->canonicalRow((array) $row, $types));
                }
                $targetHashes[$table] = hash_final($hash);
                if (! hash_equals($sourceHashes[$table], $targetHashes[$table])) {
                    throw new RuntimeException("Content hash mismatch for {$table}.");
                }
            }
            $target->statement('SET FOREIGN_KEY_CHECKS=1');
            $target->commit();
        } catch (Throwable $exception) {
            $target->rollBack();
            $target->statement('SET FOREIGN_KEY_CHECKS=1');
            throw $exception;
        }

        return [$sourceHashes, $targetCounts, $targetHashes];
    }

    private function assertCompatibleSchemas(Connection $source, Connection $target): array
    {
        $sourceTables = $source->table('information_schema.tables')
            ->where('table_schema', 'public')->where('table_type', 'BASE TABLE')
            ->where('table_name', 'not like', '\\_%')->orderBy('table_name')->pluck('table_name')->all();
        $database = $target->selectOne('SELECT DATABASE() AS name')?->name;
        $targetTables = $target->table('information_schema.tables')
            ->where('table_schema', $database)->where('table_type', 'BASE TABLE')
            ->whereNotIn('table_name', self::TARGET_ONLY_TABLES)->orderBy('table_name')
            ->selectRaw('TABLE_NAME AS table_name')->pluck('table_name')->all();
        if ($sourceTables !== $targetTables) {
            throw new RuntimeException('Source and target table sets differ; apply the generated MySQL schema first.');
        }

        return $sourceTables;
    }

    private function sourceColumns(Connection $source, string $table): array
    {
        return $source->table('information_schema.columns')->where('table_schema', 'public')
            ->where('table_name', $table)->orderBy('ordinal_position')->get(['column_name', 'data_type', 'udt_name'])
            ->mapWithKeys(fn (object $row): array => [
                $row->column_name => $row->data_type === 'ARRAY' ? "ARRAY:{$row->udt_name}" : $row->data_type,
            ])->all();
    }

    private function targetColumns(Connection $target, string $table): array
    {
        $database = $target->selectOne('SELECT DATABASE() AS name')?->name;

        return $target->table('information_schema.columns')->where('table_schema', $database)
            ->where('table_name', $table)->orderBy('ordinal_position')
            ->selectRaw('COLUMN_NAME AS column_name, DATA_TYPE AS data_type')
            ->pluck('data_type', 'column_name')->all();
    }

    private function primaryKey(Connection $target, string $table): array
    {
        $database = $target->selectOne('SELECT DATABASE() AS name')?->name;
        $columns = $target->table('information_schema.key_column_usage')->where('table_schema', $database)
            ->where('table_name', $table)->where('constraint_name', 'PRIMARY')
            ->orderBy('ordinal_position')->selectRaw('COLUMN_NAME AS column_name')->pluck('column_name')->all();
        if ($columns === []) {
            throw new RuntimeException("Target table {$table} has no primary key.");
        }

        return $columns;
    }

    private function assertNoOrphans(Connection $target): void
    {
        $database = $target->selectOne('SELECT DATABASE() AS name')?->name;
        $foreignKeys = $target->table('information_schema.key_column_usage')
            ->where('table_schema', $database)->whereNotNull('referenced_table_name')
            ->get([
                'table_name as child_table', 'column_name as child_column',
                'referenced_table_name as parent_table', 'referenced_column_name as parent_column',
            ]);
        foreach ($foreignKeys as $foreignKey) {
            $orphans = $target->table("{$foreignKey->child_table} as child")
                ->leftJoin("{$foreignKey->parent_table} as parent", "child.{$foreignKey->child_column}", '=', "parent.{$foreignKey->parent_column}")
                ->whereNotNull("child.{$foreignKey->child_column}")
                ->whereNull("parent.{$foreignKey->parent_column}")->limit(1)->exists();
            if ($orphans) {
                throw new RuntimeException("Orphaned foreign key in {$foreignKey->child_table}.{$foreignKey->child_column}.");
            }
        }
    }

    private function counts(Connection $connection, array $tables): array
    {
        $counts = [];
        foreach ($tables as $table) {
            $counts[$table] = $connection->table($table)->count();
        }

        return $counts;
    }

    private function canonicalRow(array $row, array $types): string
    {
        $normalized = [];
        foreach ($types as $column => $type) {
            $value = $row[$column] ?? null;
            if ($value === null) {
                $normalized[$column] = null;
            } elseif ($type === 'boolean') {
                $normalized[$column] = filter_var($value, FILTER_VALIDATE_BOOL) ? '1' : '0';
            } elseif (str_contains($type, 'timestamp')) {
                $normalized[$column] = CarbonImmutable::parse((string) $value)->utc()->format('Y-m-d\TH:i:s.u\Z');
            } elseif (str_starts_with($type, 'ARRAY:') || in_array($type, ['json', 'jsonb'], true)) {
                $decoded = is_string($value) ? json_decode($value, true, 512, JSON_THROW_ON_ERROR) : $value;
                $normalized[$column] = $this->canonicalJson($decoded);
            } else {
                $normalized[$column] = (string) $value;
            }
        }

        return json_encode($normalized, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
    }

    private function canonicalJson(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map($this->canonicalJson(...), $value);
    }

    private function writeReport(array $report): string
    {
        $requested = $this->option('report');
        $filename = $requested ? basename((string) $requested) : 'migration-'.now()->utc()->format('Ymd-His').'-'.Str::lower(Str::random(6)).'.json';
        if (! preg_match('/^[A-Za-z0-9._-]+\.json$/', $filename)) {
            throw new RuntimeException('The report option must be a safe JSON filename.');
        }
        $directory = storage_path('app/migration-reports');
        if (! is_dir($directory) && ! mkdir($directory, 0750, true) && ! is_dir($directory)) {
            throw new RuntimeException('Unable to create the migration report directory.');
        }
        $path = $directory.DIRECTORY_SEPARATOR.$filename;
        if (file_put_contents($path, json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR), LOCK_EX) === false) {
            throw new RuntimeException('Unable to write the migration report.');
        }

        return $path;
    }
}
