<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\URL;

class LibraryAsset extends Model
{
    protected $fillable = ['user_id', 'category_id', 'key', 'name', 'tags', 'source', 'status', 'disk', 'path', 'mime', 'width', 'height', 'tintable', 'hash', 'meta', 'archived_at'];

    protected function casts(): array
    {
        return ['tags' => 'array', 'meta' => 'array', 'tintable' => 'boolean', 'archived_at' => 'datetime'];
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(AssetCategory::class, 'category_id');
    }

    /** What a user may see: approved system assets, their own assets (any status), never archived ones. */
    public function scopeVisibleTo(Builder $q, int $userId): Builder
    {
        return $q->whereNull('archived_at')->where(function ($w) use ($userId) {
            $w->where(fn ($s) => $s->whereNull('user_id')->where('status', 'approved'))->orWhere('user_id', $userId);
        });
    }

    public function isSystem(): bool
    {
        return $this->user_id === null;
    }

    public function present(): array
    {
        return [
            'id' => $this->id,
            'key' => $this->key,
            'category' => $this->category?->slug,
            'name' => $this->name,
            'tags' => $this->tags ?? [],
            'source' => $this->source,
            'status' => $this->status,
            'mime' => $this->mime,
            'width' => $this->width,
            'height' => $this->height,
            'tintable' => $this->tintable,
            'hash' => $this->hash,
            'mine' => $this->user_id !== null,
            'meta' => $this->source === 'ai' ? ['prompt' => $this->meta['prompt'] ?? null, 'model' => $this->meta['model'] ?? null] : null,
            // relative URL: goes through the same origin as the app (dev proxy / nginx), so canvas + fetch need no CORS
            'url' => URL::temporarySignedRoute('library.file', now()->addHours(12), ['asset' => $this->id], absolute: false),
        ];
    }
}
