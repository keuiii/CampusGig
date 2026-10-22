<?php

namespace App\Http\Controllers;

use App\Services\Storage\MalwareScanner;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

final class MetricsController extends Controller
{
    public function __invoke(MalwareScanner $scanner): Response
    {
        $dependencies = [
            'database' => $this->available(fn (): mixed => DB::select('SELECT 1')),
            'storage' => $this->available(function (): bool {
                $disk = (string) config('campusgig.private_storage_disk', 'campusgig_private');

                return Storage::disk($disk)->exists('.');
            }),
            'malware_scanner' => $scanner->available(),
        ];

        $lines = [
            '# HELP campusgig_api_info CampusGig API runtime information.',
            '# TYPE campusgig_api_info gauge',
            'campusgig_api_info{runtime="laravel"} 1',
            '# HELP campusgig_dependency_up Whether a required CampusGig dependency passed its latest check.',
            '# TYPE campusgig_dependency_up gauge',
        ];
        foreach ($dependencies as $name => $available) {
            $lines[] = sprintf('campusgig_dependency_up{dependency="%s"} %d', $name, $available ? 1 : 0);
        }

        $response = response(implode("\n", $lines)."\n", 200, [
            'Content-Type' => 'text/plain; version=0.0.4; charset=utf-8',
        ]);
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }

    private function available(callable $probe): bool
    {
        try {
            return $probe() !== false;
        } catch (Throwable $exception) {
            report($exception);

            return false;
        }
    }
}
