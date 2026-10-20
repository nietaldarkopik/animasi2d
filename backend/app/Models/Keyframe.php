<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Keyframe extends Model
{
    public $timestamps = false;

    protected $fillable = ['layer_id', 'property', 'frame', 'value', 'easing'];

    protected function casts(): array
    {
        return ['value' => 'float'];
    }

    public function layer(): BelongsTo
    {
        return $this->belongsTo(Layer::class);
    }
}
