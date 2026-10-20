<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],


    'python' => [
        // ?: (not the env() default): an EMPTY value in .env must fall back too, not override the default path
        'bin' => env('PYTHON_BIN') ?: 'python',
        'worker_dir' => env('WORKER_DIR') ?: base_path('../worker'),
    ],

    // OpenAI-compatible gateway (9router by default). The key stays on the server.
    'ai' => [
        'base_url' => rtrim(env('AI_BASE_URL', 'http://127.0.0.1:20128/v1'), '/'),
        'api_key' => env('AI_API_KEY'),
        'model' => env('AI_MODEL', 'Kombo'),
        'timeout' => (int) env('AI_TIMEOUT', 120),
    ],

    // Optional image-editing provider (OpenAI-compatible POST {base_url}/images/edits) for Colorize / AI Redraw.
    // OFF by default: user images are only ever sent when this is enabled AND the request carries explicit consent.
    'ai_image' => [
        'enabled' => (bool) env('AI_IMAGE_ENABLED', false),
        'model' => env('AI_IMAGE_MODEL'),
        'timeout' => (int) env('AI_IMAGE_TIMEOUT', 120),
        'daily_limit' => (int) env('AI_IMAGE_DAILY_LIMIT', 20),
    ],

    // Local AI super-resolution (Real-ESRGAN ncnn/Vulkan binary, see tools/realesrgan). Nothing leaves the machine.
    'upscaler' => [
        'bin' => env('REALESRGAN_BIN') ?: base_path('../tools/realesrgan/realesrgan-ncnn-vulkan'.(PHP_OS_FAMILY === 'Windows' ? '.exe' : '')),
        'model' => env('REALESRGAN_MODEL') ?: 'realesrgan-x4plus-anime',
    ],

    'ffmpeg' => [
        'bin' => env('FFMPEG_BIN') ?: 'ffmpeg',
        'probe' => env('FFPROBE_BIN') ?: 'ffprobe',
    ],

];

