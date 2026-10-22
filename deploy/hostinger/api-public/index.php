<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$applicationRoot = dirname(__DIR__, 2).'/laravel-api';

if (file_exists($maintenance = $applicationRoot.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $applicationRoot.'/vendor/autoload.php';

/** @var Application $app */
$app = require_once $applicationRoot.'/bootstrap/app.php';

$app->handleRequest(Request::capture());
