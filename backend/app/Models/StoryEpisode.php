<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StoryEpisode extends Model
{
    protected $fillable = ['series_id', 'number', 'title', 'synopsis', 'script', 'status', 'scheduled_at', 'project_id', 'output_path', 'publish', 'published_url', 'error'];

    protected function casts(): array
    {
        return ['script' => 'array', 'scheduled_at' => 'datetime', 'publish' => 'boolean'];
    }

    public function series(): BelongsTo
    {
        return $this->belongsTo(StorySeries::class, 'series_id');
    }
}
