<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

class LibraryAsset extends Model
{
    protected $fillable = ['user_id', 'category_id', 'key', 'name', 'tags', 'source', 'status', 'disk', 'path', 'mime', 'width', 'height', 'tintable', 'hash', 'meta', 'archived_at', 'asset_uuid', 'version_number', 'parent_asset_id', 'is_current', 'change_note'];

    protected function casts(): array
    {
        return ['tags' => 'array', 'meta' => 'array', 'tintable' => 'boolean', 'archived_at' => 'datetime', 'is_current' => 'boolean'];
    }

    protected static function booted(): void
    {
        static::creating(function (LibraryAsset $asset) {
            $asset->asset_uuid ??= (string) Str::uuid();
            $asset->version_number ??= 1;
            $asset->is_current ??= true;
        });
    }

    public function parentVersion(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_asset_id');
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

    /** @return array{dx: float, dy: float}|null */
    private function alignment(): ?array
    {
        $slot = $this->category?->slug;
        if (! $slot || empty($this->meta['anchors'])) {
            return null;
        }
        $tpl = \App\Services\Library\DesignTemplate::load($this->meta['template'] ?? \App\Services\Library\DesignTemplate::DEFAULT);
        $expected = $tpl->expectedAnchors($slot, $this->meta['view'] ?? 'front', $this->meta['family'] ?? null);

        return \App\Services\Library\AnchorExtractor::alignment($slot, $this->meta['anchors'], $expected);
    }

    public function present(): array
    {
        return [
            'id' => $this->id,
            'asset_uuid' => $this->asset_uuid,
            'version_number' => (int) $this->version_number,
            'parent_asset_id' => $this->parent_asset_id,
            'is_current' => (bool) $this->is_current,
            'change_note' => $this->change_note,
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
            'view' => $this->meta['view'] ?? 'front',
            'anchors' => $this->meta['anchors'] ?? null, // named attachment points measured from the art (canvas units)
            'align' => $this->alignment(), // how far to move the part so its anchors land on the template's (null = already in place / not aligned)
            'family' => $this->meta['family'] ?? null, // design family: which parts it was drawn with and fits (see DesignFamily)
            'template' => $this->meta['template'] ?? 'anime-v1', // the design template (character family / art-style preset) the part was made for
            'validation' => isset($this->meta['validation']) ? array_intersect_key($this->meta['validation'], array_flip(['ok', 'errors', 'warnings', 'held', 'checked_at'])) : null,
            'mirror' => $this->meta['mirror'] ?? null, // one shoe stored for the left foot: {px, py} = its pivot; the right foot is its mirror image
            'set' => $this->meta['set'] ?? null, // the same part drawn for each facing shares one set key
            'hash' => $this->hash,
            'mine' => $this->user_id !== null,
            'meta' => $this->source === 'ai' ? ['prompt' => $this->meta['prompt'] ?? null, 'model' => $this->meta['model'] ?? null] : null,
            // relative URL: goes through the same origin as the app (dev proxy / nginx), so canvas + fetch need no CORS
            'url' => URL::temporarySignedRoute('library.file', \App\Models\Asset::urlExpiry(), ['asset' => $this->id], absolute: false),
        ];
    }
}
