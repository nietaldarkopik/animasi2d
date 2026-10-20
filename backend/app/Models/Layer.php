<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Layer extends Model
{
    protected $fillable = ['animation_scene_id', 'layer_key', 'parent_key', 'type', 'name', 'z_order', 'asset_id', 'visible', 'locked', 'properties'];

    protected function casts(): array
    {
        return ['properties' => 'array', 'visible' => 'boolean', 'locked' => 'boolean'];
    }

    public function scene(): BelongsTo
    {
        return $this->belongsTo(AnimationScene::class, 'animation_scene_id');
    }

    public function keyframes(): HasMany
    {
        return $this->hasMany(Keyframe::class)->orderBy('property')->orderBy('frame');
    }
}
