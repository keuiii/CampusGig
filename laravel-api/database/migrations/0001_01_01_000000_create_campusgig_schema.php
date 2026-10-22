<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            return;
        }

        $path = database_path('schema/campusgig.mysql.sql');
        if (! is_file($path)) {
            throw new RuntimeException("CampusGig schema file is missing: {$path}");
        }

        $sql = file_get_contents($path);
        if ($sql === false || trim($sql) === '') {
            throw new RuntimeException("CampusGig schema file is empty: {$path}");
        }

        DB::unprepared($sql);
    }

    public function down(): void
    {
        throw new RuntimeException(
            'The CampusGig production schema is forward-only. Restore a verified backup instead of rolling it back.',
        );
    }
};
