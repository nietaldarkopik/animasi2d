<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('asset_categories', function (Blueprint $table) {
            $table->id();
            $table->string('slug', 32)->unique();
            $table->string('name', 64);
            $table->string('kind', 12);                    // part | background
            $table->unsignedSmallInteger('z_order')->default(0); // stacking order of character slots (low = behind)
            $table->unsignedSmallInteger('sort')->default(0);
        });

        // Global asset library: system assets (user_id NULL, seeded) + the user's own uploads / AI results.
        Schema::create('library_assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('category_id')->constrained('asset_categories');
            $table->string('key', 64)->nullable()->unique(); // stable id for seeded system assets
            $table->string('name', 120);
            $table->json('tags')->nullable();
            $table->string('source', 8)->default('upload');   // system | upload | ai
            $table->string('status', 10)->default('approved'); // approved | pending | rejected (AI results await review)
            $table->string('disk', 32);
            $table->string('path');
            $table->string('mime', 32);
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->boolean('tintable')->default(false);      // SVG with data-tint regions
            $table->char('hash', 64);                          // sha256 of the stored file: pins what a character version looked like
            $table->json('meta')->nullable();                  // AI prompt/model, licence note, ...
            $table->timestamp('archived_at')->nullable();      // referenced assets are archived, never deleted
            $table->timestamps();
            $table->index(['category_id', 'status']);
            $table->index(['user_id', 'status']);
        });

        Schema::table('characters', function (Blueprint $table) {
            $table->string('kind', 8)->default('rig')->after('user_id'); // rig = layer tree (earlier feature) | builder
            $table->unsignedInteger('current_version')->nullable()->after('method');
            $table->index(['user_id', 'kind']);
        });

        // Immutable snapshots: a film that used version N keeps looking the same when the character is edited later.
        Schema::create('character_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('character_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('number');
            $table->json('config');                  // schema_version, palette, parts{slot:{assetId,hash,dx,dy,scale}}
            $table->string('thumbnail_path')->nullable();
            $table->string('note', 200)->nullable();
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['character_id', 'number']);
        });

        Schema::create('character_version_assets', function (Blueprint $table) {
            $table->foreignId('character_version_id')->constrained()->cascadeOnDelete();
            $table->foreignId('library_asset_id')->constrained('library_assets')->restrictOnDelete();
            $table->primary(['character_version_id', 'library_asset_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('character_version_assets');
        Schema::dropIfExists('character_versions');
        Schema::table('characters', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'kind']);
            $table->dropColumn(['kind', 'current_version']);
        });
        Schema::dropIfExists('library_assets');
        Schema::dropIfExists('asset_categories');
    }
};
