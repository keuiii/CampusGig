<?php

use App\Services\DisputeService;
use App\Services\OrderService;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('orders:reconcile-expired-reviews {--limit=25}', function (OrderService $orders): void {
    $count = $orders->reconcileExpiredReviews((int) $this->option('limit'));
    $this->info("Completed {$count} expired order review(s).");
})->purpose('Complete eligible orders after the delivery review window');

Artisan::command('disputes:reconcile-expired-responses {--limit=25}', function (DisputeService $disputes): void {
    $count = $disputes->reconcileExpiredResponses((int) $this->option('limit'));
    $this->info("Moved {$count} expired dispute response(s) to admin review.");
})->purpose('Move expired dispute response windows to administrator review');

Schedule::command('orders:reconcile-expired-reviews')->everyMinute()->withoutOverlapping();
Schedule::command('disputes:reconcile-expired-responses')->everyMinute()->withoutOverlapping();
Schedule::command('campusgig:malware-signatures:update')->dailyAt('03:30')->withoutOverlapping();
