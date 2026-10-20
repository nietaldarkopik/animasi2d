<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Immutable snapshot of a builder character (no update path is exposed anywhere). */
class CharacterVersion extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['character_id', 'number', 'config', 'thumbnail_path', 'note'];

    protected function casts(): array
    {
        return ['config' => 'array'];
    }
}
