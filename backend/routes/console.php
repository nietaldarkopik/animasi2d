<?php

use Illuminate\Support\Facades\Schedule;

// Housekeeping (needs `php artisan schedule:work`, or a cron entry running `schedule:run` every minute).
Schedule::command('studio:prune')->dailyAt('03:15')->onOneServer()->withoutOverlapping();
Schedule::command('sanctum:prune-expired --hours=24')->dailyAt('03:30')->onOneServer();

// Otomatis membuat kartun harian setiap pagi jam 07:00
Schedule::command('cartoon:generate-daily --export')->dailyAt('07:00')->withoutOverlapping();

