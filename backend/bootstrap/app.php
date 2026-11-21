<?php

use Illuminate\\Auth\\AuthenticationException;
use Illuminate\\Foundation\\Application;
use Illuminate\\Foundation\\Configuration\\Exceptions;
use Illuminate\\Foundation\\Configuration\\Middleware;
use Illuminate\\Http\\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind nginx / a load balancer the real scheme and host come from X-Forwarded-*; without this the signed
        // asset URLs would be generated for the wrong host/scheme and fail signature validation.
        // TRUSTED_PROXIES: "*" (trust every hop, fine when only the proxy can reach the app) or a comma-separated IP/CIDR list.
        if ($proxies = env('TRUSTED_PROXIES')) {
            $middleware->trustProxies(at: $proxies === '*' ? '*' : array_map('trim', explode(',', $proxies)));
        }
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // API requests must never redirect to the web login route. The frontend uses bearer tokens
        // and handles a JSON 401 by sending the user to its own /login page.
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Unauthenticated.'], 401);
            }

            return null;
        });

        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
