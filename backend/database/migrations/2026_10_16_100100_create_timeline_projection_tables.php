<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Reusable characters (library): a named group of parts, each pointing at an image asset.
        Schema::create('characters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 120);
            $table->string('method', 16)->default('rig'); // rig | frame_by_frame
            $table->foreignId('source_asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->timestamps();
            $table->index(['user_id', 'name']);
        });

        Schema::create('character_parts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('character_id')->constrained()->cascadeOnDelete();
            $table->foreignId('asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->string('part_key', 64);               // layer id inside the character template
            $table->string('name', 120);
            $table->string('type', 8)->default('image');  // image | bone | text | shape
            $table->string('parent_key', 64)->nullable();
            $table->unsignedSmallInteger('z_order')->default(0);
            $table->json('layer');                        // the full layer as authored (transform, pivot, ik, keyframes)
            $table->timestamps();
            $table->unique(['character_id', 'part_key']);
        });

        // Relational projection of the project document. The JSON document stays the source of truth for the editor;
        // these tables are rewritten from it inside the same transaction as every save, so they can be queried and indexed.
        Schema::create('animation_scenes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('scene_key', 64);
            $table->string('name', 80);
            $table->unsignedSmallInteger('position');
            $table->decimal('duration', 8, 3);
            $table->string('background', 7);
            $table->json('transition')->nullable();
            $table->timestamps();
            $table->unique(['project_id', 'scene_key']);
            $table->index(['project_id', 'position']);
        });

        Schema::create('layers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('animation_scene_id')->constrained()->cascadeOnDelete();
            $table->string('layer_key', 64);
            $table->string('parent_key', 64)->nullable();
            $table->string('type', 8);
            $table->string('name', 120);
            $table->unsignedSmallInteger('z_order');
            $table->foreignId('asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->boolean('visible')->default(true);
            $table->boolean('locked')->default(false);
            $table->json('properties'); // base transform, pivot, ik, text/shape attributes
            $table->timestamps();
            $table->unique(['animation_scene_id', 'layer_key']);
        });

        Schema::create('keyframes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('layer_id')->constrained()->cascadeOnDelete();
            $table->string('property', 16);
            $table->unsignedInteger('frame');
            $table->double('value');
            $table->string('easing', 12)->default('linear');
            $table->unique(['layer_id', 'property', 'frame']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('keyframes');
        Schema::dropIfExists('layers');
        Schema::dropIfExists('animation_scenes');
        Schema::dropIfExists('character_parts');
        Schema::dropIfExists('characters');
    }
};
