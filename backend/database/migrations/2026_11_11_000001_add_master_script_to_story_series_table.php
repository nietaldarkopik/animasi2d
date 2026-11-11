<?php

use Illuminate\Database\\Migrations\\Migration;
use Illuminate\Database\\Schema\\Blueprint;
use Illuminate\Support\\Facades\\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('story_series', function (Blueprint $table) {
            $table->longText('master_script')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('story_series', function (Blueprint $table) {
            $table->dropColumn('master_script');
        });
    }
};
