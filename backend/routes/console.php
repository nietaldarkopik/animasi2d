<?php

use Illuminate\Support\Facades\Schedule;

// Housekeeping (needs `php artisan schedule:work`, or a cron entry running `schedule:run` every minute).
Schedule::command('studio:prune')->dailyAt('03:15')->onOneServer()->withoutOverlapping();
Schedule::command('sanctum:prune-expired --hours=24')->dailyAt('03:30')->onOneServer();

// Dua film kartun otomatis per hari. --publish mengunggahnya ke YouTube (clipper-tool) hanya bila CLIPPER_* di .env terisi;
// tanpa itu film cukup dibuat dan disimpan di daily_output/.
$publish = config('services.clipper.account') && config('services.clipper.path') ? ' --publish' : '';
Schedule::command('cartoon:generate-daily --export --slot=0'.$publish)->dailyAt('07:00')->withoutOverlapping();
Schedule::command('cartoon:generate-daily --export --slot=1'.$publish)->dailyAt('15:00')->withoutOverlapping();

// Cerita berseri: film episode yang jadwalnya tiba (jam sendiri atau film harian otomatis per seri)
Schedule::command('story:run-due')->everyFiveMinutes()->withoutOverlapping();
