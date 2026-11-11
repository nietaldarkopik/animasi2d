<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StorySeries extends Model
{
    protected $table = 'story_series';

    protected $fillable = ['user_id', 'title', 'premise', 'master_script', 'genre', 'tone', 'narration_style', 'use_narrator', 'narrator_voice', 'characters', 'notes', 'episodes_planned',
        'auto_run', 'schedule_time', 'auto_publish', 'last_auto_date', 'ai_status', 'ai_message'];

    protected function casts(): array
    {
        return ['characters' => 'array', 'use_narrator' => 'boolean', 'auto_run' => 'boolean', 'auto_publish' => 'boolean', 'last_auto_date' => 'date'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function episodes(): HasMany
    {
        return $this->hasMany(StoryEpisode::class, 'series_id')->orderBy('number');
    }

    /** @return list<string> */
    public function characterNames(): array
    {
        return array_values(array_map(fn ($c) => (string) $c['name'], $this->characters ?? []));
    }

    /** lower-case name => Character Builder id, for the characters that have one (the film uses exactly that character) */
    public function characterIds(): array
    {
        $map = [];
        foreach ($this->characters ?? [] as $c) {
            if (! empty($c['id'])) {
                $map[mb_strtolower($c['name'])] = (int) $c['id'];
            }
        }

        return $map;
    }

    /** lower-case name => edge-tts voice for the characters (and the narrator) */
    public function voices(): array
    {
        $map = [];
        foreach ($this->characters ?? [] as $c) {
            if (! empty($c['voice'])) {
                $map[mb_strtolower($c['name'])] = $c['voice'] === 'female' ? 'id-ID-GadisNeural' : 'id-ID-ArdiNeural';
            }
        }
        if ($this->use_narrator) {
            $map['narator'] = $map['narrator'] = $this->narrator_voice;
        }

        return $map;
    }
}
