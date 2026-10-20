<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::rename('ai_jobs', 'animation_jobs');
        Schema::rename('export_jobs', 'render_jobs');

        Schema::table('assets', function (Blueprint $table) {
            // original = untouched upload, enhanced = result of the enhancement studio, character = prepared part image
            $table->string('kind', 16)->default('original')->after('user_id');
            $table->foreignId('parent_id')->nullable()->after('kind')->constrained('assets')->nullOnDelete();
            $table->string('mode', 24)->nullable()->after('parent_id'); // enhancement mode that produced this version
            $table->json('meta')->nullable()->after('mode');            // ops, notes, provider, ...
            $table->index(['project_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::table('assets', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_id');
            $table->dropIndex(['project_id', 'kind']);
            $table->dropColumn(['kind', 'mode', 'meta']);
        });
        Schema::rename('render_jobs', 'export_jobs');
        Schema::rename('animation_jobs', 'ai_jobs');
    }
};
