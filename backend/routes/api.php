<?php

use App\Http\Controllers\AiController;
use App\Http\Controllers\AssetController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BuilderCharacterController;
use App\Http\Controllers\CharacterController;
use App\Http\Controllers\LibraryController;
use App\Http\Controllers\EnhancementController;
use App\Http\Controllers\ExportController;
use App\Http\Controllers\ProjectController;
use Illuminate\Support\Facades\Route;

Route::get('/auth/options', [AuthController::class, 'options']);
Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:10,1');
Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

// Signed (expiring) URL: lets <img>/PixiJS load private assets without an Authorization header.
Route::get('/assets/{asset}/file', [AssetController::class, 'file'])->name('assets.file')->middleware('signed');

Route::get('/library/assets/{asset}/file', [LibraryController::class, 'file'])->name('library.file')->middleware('signed:relative');
Route::get('/builder/versions/{version}/thumbnail', [BuilderCharacterController::class, 'thumbnail'])->name('builder.thumbnail')->middleware('signed:relative');

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/library/categories', [LibraryController::class, 'categories']);
    Route::get('/library/assets', [LibraryController::class, 'index']);
    Route::post('/library/assets', [LibraryController::class, 'store'])->middleware('throttle:30,1');
    Route::post('/library/assets/{asset}/file', [LibraryController::class, 'replace'])->middleware('throttle:30,1');
    Route::post('/library/assets/{asset}/duplicate', [LibraryController::class, 'duplicate'])->middleware('throttle:30,1');
    Route::patch('/library/assets/{asset}', [LibraryController::class, 'update']);
    Route::delete('/library/assets/{asset}', [LibraryController::class, 'destroy']);
    Route::post('/library/assets/{asset}/upscale', [LibraryController::class, 'upscale'])->middleware('throttle:10,1');
    Route::post('/library/ai/generate', [LibraryController::class, 'generate'])->middleware('throttle:10,1');

    Route::get('/builder/characters', [BuilderCharacterController::class, 'index']);
    Route::post('/builder/characters', [BuilderCharacterController::class, 'store'])->middleware('throttle:60,1');
    Route::get('/builder/characters/{character}', [BuilderCharacterController::class, 'show']);
    Route::patch('/builder/characters/{character}', [BuilderCharacterController::class, 'rename']);
    Route::post('/builder/characters/{character}/versions', [BuilderCharacterController::class, 'addNewVersion'])->middleware('throttle:60,1');
    Route::post('/builder/characters/{character}/duplicate', [BuilderCharacterController::class, 'duplicate']);
    Route::delete('/builder/characters/{character}', [BuilderCharacterController::class, 'destroy']);

    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);

    Route::get('/projects', [ProjectController::class, 'index']);
    Route::post('/projects', [ProjectController::class, 'store']);
    Route::get('/projects/{project}', [ProjectController::class, 'show']);
    Route::put('/projects/{project}', [ProjectController::class, 'update']);
    Route::delete('/projects/{project}', [ProjectController::class, 'destroy']);
    Route::post('/projects/{project}/duplicate', [ProjectController::class, 'duplicate']);
    Route::get('/projects/{project}/versions', [ProjectController::class, 'versions']);
    Route::post('/projects/{project}/versions/{number}/restore', [ProjectController::class, 'restoreVersion']);

    Route::get('/projects/{project}/assets', [AssetController::class, 'index']);
    Route::post('/projects/{project}/assets', [AssetController::class, 'store'])->middleware('throttle:uploads');
    Route::post('/projects/{project}/audio', [AssetController::class, 'storeAudio'])->middleware('throttle:audio');
    Route::delete('/assets/{asset}', [AssetController::class, 'destroy']);
    Route::post('/assets/{asset}/process', [AssetController::class, 'process'])->middleware('throttle:20,1');

    Route::get('/characters', [CharacterController::class, 'index']);
    Route::post('/projects/{project}/characters', [CharacterController::class, 'store']);
    Route::post('/characters/{character}/instantiate', [CharacterController::class, 'instantiate']);
    Route::delete('/characters/{character}', [CharacterController::class, 'destroy']);

    Route::get('/enhance/modes', [EnhancementController::class, 'modes']);
    Route::post('/assets/{asset}/enhance', [EnhancementController::class, 'enhance'])->middleware('throttle:20,1');
    Route::get('/assets/{asset}/versions', [EnhancementController::class, 'versions']);

    Route::get('/ai/status',[AiController::class, 'status']);
    Route::post('/projects/{project}/ai/motion', [AiController::class, 'motion'])->middleware('throttle:10,1');
    Route::post('/assets/{asset}/ai/segment', [AiController::class, 'segment'])->middleware('throttle:10,1');
    Route::post('/ai/jobs/{job}/segment/apply', [AiController::class, 'applySegment'])->middleware('throttle:10,1');
    Route::get('/ai/jobs/{job}', [AiController::class, 'show']);

    Route::get('/projects/{project}/exports', [ExportController::class, 'index']);
    Route::post('/projects/{project}/exports', [ExportController::class, 'store'])->middleware('throttle:10,1');
    Route::get('/exports/{export}', [ExportController::class, 'show']);
    Route::get('/exports/{export}/download', [ExportController::class, 'download']);

    Route::get('/cartoon/status', [\App\Http\Controllers\DailyCartoonController::class, 'status']);
    Route::post('/cartoon/generate', [\App\Http\Controllers\DailyCartoonController::class, 'generate'])->middleware('throttle:10,1');
});

