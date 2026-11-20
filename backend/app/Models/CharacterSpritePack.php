<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CharacterSpritePack extends Model
{
    protected $fillable = [
        'user_id', 'character_id', 'character_version', 'name', 'disk', 'path', 'mime',
        'image_width', 'image_height', 'frame_width', 'frame_height', 'columns', 'rows',
        'frame_count', 'fps', 'facing', 'manifest', 'sha256', 'status',
    ];

    protected function casts(): array
    {
        return ['manifest' => 'array'];
    }

    public function character(): BelongsTo
    {
        return $this->belongsTo(Character::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
