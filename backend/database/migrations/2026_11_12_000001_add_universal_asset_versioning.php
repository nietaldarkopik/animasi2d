<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('library_assets', function (Blueprint $table) {
            $table->string('asset_uuid', 36)->nullable()->after('id');
            $table->unsignedInteger('version_number')->default(1)->after('asset_uuid');
            $table->unsignedBigInteger('parent_asset_id')->nullable()->after('version_number');
            $table->boolean('is_current')->default(true)->after('parent_asset_id');
            $table->string('change_note', 200)->nullable()->after('is_current');
            $table->unique(['asset_uuid', 'version_number'], 'library_assets_uuid_version_unique');
            $table->index(['asset_uuid', 'is_current'], 'library_assets_uuid_current_index');
            $table->foreign('parent_asset_id')->references('id')->on('library_assets')->nullOnDelete();
        });

        DB::table('library_assets')->select('id')->orderBy('id')->chunk(200, function ($rows) {
            foreach ($rows as $row) {
                DB::table('library_assets')->where('id', $row->id)->update(['asset_uuid' => (string) Str::uuid()]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('library_assets', function (Blueprint $table) {
            $table->dropForeign(['parent_asset_id']);
            $table->dropUnique('library_assets_uuid_version_unique');
            $table->dropIndex('library_assets_uuid_current_index');
            $table->dropColumn(['asset_uuid', 'version_number', 'parent_asset_id', 'is_current', 'change_note']);
        });
    }
};
