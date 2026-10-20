<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('render_jobs', function (Blueprint $table) {
            $table->json('options')->nullable()->after('audio'); // e.g. sprite sheet frame limit
        });
    }

    public function down(): void
    {
        Schema::table('render_jobs', fn (Blueprint $t) => $t->dropColumn('options'));
    }
};
