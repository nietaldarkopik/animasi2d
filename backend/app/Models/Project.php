<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Project extends Model
{
    protected $fillable = ['user_id', 'name', 'document', 'revision'];

    protected function casts(): array
    {
        return ['document' => 'array'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function versions(): HasMany
    {
        return $this->hasMany(ProjectVersion::class);
    }

    public function scenes(): HasMany
    {
        return $this->hasMany(AnimationScene::class)->orderBy('position');
    }

    public function assets(): HasMany
    {
        return $this->hasMany(Asset::class);
    }

    public function exports(): HasMany
    {
        return $this->hasMany(ExportJob::class);
    }

    public static function blankDocument(): array
    {
        return \App\Support\DocumentMigrator::blank();
    }
}
