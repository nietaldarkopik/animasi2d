<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CharacterPart extends Model
{
    protected $fillable = ['character_id', 'asset_id', 'part_key', 'name', 'type', 'parent_key', 'z_order', 'layer'];

    protected function casts(): array
    {
        return ['layer' => 'array'];
    }
}
