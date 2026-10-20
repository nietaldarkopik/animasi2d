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
            'url' => URL::temporarySignedRoute('assets.file', now()->addHours(12), ['asset' => $this->id]),
        ];
    }
}