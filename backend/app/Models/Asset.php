<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\URL;

class Asset extends Model
{
    protected function casts(): array
    {
        return ['meta' => 'array'];
    }

    protected $fillable = ['project_id', 'user_id', 'disk', 'path', 'original_name', 'mime', 'size', 'width', 'height', 'duration', 'kind', 'parent_id', 'mode', 'meta'];

    /** API representation with a short-lived signed URL (private files, no Authorization header needed for <img>). */
    /**
     * Expiry of a signed file URL, rounded to a 30-minute step (+12 h). The signature depends on the expiry, so a clock-exact
     * expiry gave every page load NEW URLs and the browser could never reuse its cache (a film has 100+ images). Now the URL of an
     * asset stays the same for up to 30 minutes.
     */
    public static function urlExpiry(): \DateTimeInterface
    {
        return \Illuminate\Support\Carbon::createFromTimestamp(intdiv(time(), 1800) * 1800 + 12 * 3600);
    }

    public function present(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->original_name,
            'mime' => $this->mime,
            'size' => $this->size,
            'width' => $this->width,
            'height' => $this->height,
            'duration' => $this->duration,
            'kind' => $this->kind,
            'parent_id' => $this->parent_id,
            'mode' => $this->mode,
            'url' => URL::temporarySignedRoute('assets.file', self::urlExpiry(), ['asset' => $this->id]),
        ];
    }
}