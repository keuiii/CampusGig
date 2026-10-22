<?php

namespace App\Http\Controllers;

use App\Services\Storage\MalwareScanner;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

final class HealthController extends Controller
{
    public function health(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'service' => 'campusgig-api',
            'timestamp' => now()->toISOString(),
        ]);
    }

    public function ready(MalwareScanner $scanner): JsonResponse
    {
        try {
            DB::select('SELECT 1');
            $disk = (string) config('campusgig.private_storage_disk', 'campusgig_private');
            $probe = '.health/'.Str::uuid();
            if (! Storage::disk($disk)->put($probe, 'ready')) {
                throw new \RuntimeException('Private storage is not writable.');
            }
            Storage::disk($disk)->delete($probe);
            if (! $scanner->available()) {
                throw new \RuntimeException('The malware scanner is unavailable.');
            }
        } catch (Throwable $exception) {
            report($exception);

            return response()->json(['status' => 'not_ready'], 503);
        }

        return response()->json(['status' => 'ready']);
    }
}
