<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('character_sprite_packs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('character_id')->constrained('characters')->cascadeOnDelete();
            $table->unsignedInteger('character_version')->nullable();
            $table->string('name', 120);
            $table->string('disk', 32)->default('local');
            $table->string('path', 500);
            $table->string('mime', 40)->default('image/png');
            $table->unsignedInteger('image_width');
            $table->unsignedInteger('image_height');
            $table->unsignedSmallInteger('frame_width')->default(1024);
            $table->unsignedSmallInteger('frame_height')->default(1024);
            $table->unsignedSmallInteger('columns');
            $table->unsignedSmallInteger('rows');
            $table->unsignedInteger('frame_count');
            $table->unsignedSmallInteger('fps')->default(12);
            $table->string('facing', 12)->default('front');
            $table->json('manifest')->nullable();
            $table->char('sha256', 64);
            $table->string('status', 24)->default('pending_review');
            $table->timestamps();
            $table->index(['character_id', 'character_version']);
            $table->unique(['character_id', 'sha256']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('character_sprite_packs');
    }
};
