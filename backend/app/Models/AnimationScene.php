<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AnimationScene extends Model
{
    protected $fillable = ['project_id', 'scene_key', 'name', 'position', 'duration', 'background', 'transition'];

    protected function casts(): array
    {
        return ['transition' => 'array', 'duration' => 'float'];
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function layers(): HasMany
    {
        return $this->hasMany(Layer::class)->orderBy('z_order');
    }
}
