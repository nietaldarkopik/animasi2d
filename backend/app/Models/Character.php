<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Character extends Model
{
    public const METHODS = ['rig', 'frame_by_frame'];

    protected $fillable = ['user_id', 'kind', 'project_id', 'name', 'method', 'current_version', 'source_asset_id'];

    public function versions(): HasMany
    {
        return $this->hasMany(CharacterVersion::class)->orderByDesc('number');
    }

    public function parts(): HasMany
    {
        return $this->hasMany(CharacterPart::class)->orderBy('z_order');
    }
}
