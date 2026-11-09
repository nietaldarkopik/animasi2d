<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A story series: the idea the author gives (plot, characters, narration) from which episodes are written and filmed.
        Schema::create('story_series', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120);
            $table->text('premise');                                  // the plot / story line (alur)
            $table->string('genre', 60)->nullable();
            $table->string('tone', 120)->nullable();                  // e.g. "hangat, lucu, mendidik"
            $table->text('narration_style')->nullable();              // how the narrator talks; empty = no narrator
            $table->boolean('use_narrator')->default(false);
            $table->string('narrator_voice', 40)->default('id-ID-ArdiNeural');
            $table->json('characters');                               // [{name, role, traits, voice: male|female}]
            $table->text('notes')->nullable();                        // extra instructions for every episode
            $table->unsignedSmallInteger('episodes_planned')->default(5);
            $table->boolean('auto_run')->default(false);              // film the next episode every day at schedule_time
            $table->string('schedule_time', 5)->nullable();           // HH:MM
            $table->boolean('auto_publish')->default(false);          // upload to YouTube (clipper-tool) after filming
            $table->date('last_auto_date')->nullable();
            $table->string('ai_status', 10)->default('idle');         // idle | working | failed
            $table->text('ai_message')->nullable();
            $table->timestamps();
        });

        Schema::create('story_episodes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('series_id')->constrained('story_series')->cascadeOnDelete();
            $table->unsignedSmallInteger('number');
            $table->string('title', 160);
            $table->text('synopsis')->nullable();
            $table->json('script')->nullable();                       // {title, theme, scenes:[{name, location, time, dialog:[{who,text}]}]}
            $table->string('status', 12)->default('planned');         // planned | scripted | queued | producing | done | failed
            $table->timestamp('scheduled_at')->nullable();
            $table->foreignId('project_id')->nullable()->constrained('projects')->nullOnDelete();
            $table->string('output_path')->nullable();                // daily_output/<file>.mp4
            $table->boolean('publish')->default(false);
            $table->string('published_url')->nullable();
            $table->text('error')->nullable();
            $table->timestamps();

            $table->unique(['series_id', 'number']);
            $table->index(['status', 'scheduled_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('story_episodes');
        Schema::dropIfExists('story_series');
    }
};
