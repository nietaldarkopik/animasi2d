<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // Generated links (signed asset URLs) must use https when the site is served over https.
        if (str_starts_with((string) config('app.url'), 'https://')) {
            URL::forceScheme('https');
        }

        // Named limiters have their OWN counter. (A plain "throttle:60,1" shares one counter per user across every route that
        // uses the middleware, so a burst of image uploads also locked out audio uploads.) Inserting a character as a rig
        // uploads 15-25 images at once, and a script can place several characters.
        RateLimiter::for('uploads', fn (Request $r) => Limit::perMinute(400)->by('uploads:'.($r->user()?->getAuthIdentifier() ?? $r->ip())));
        RateLimiter::for('audio', fn (Request $r) => Limit::perMinute(60)->by('audio:'.($r->user()?->getAuthIdentifier() ?? $r->ip())));
    }
}
