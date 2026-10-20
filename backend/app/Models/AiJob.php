<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiJob extends Model
{
    protected $table = 'animation_jobs';

    protected $fillable = ['project_id', 'user_id', 'type', 'status', 'input', 'result', 'error'];

    public function project(): \Illuminate\Database\Eloquent\Relations\BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    protected function casts(): array
    {
        return ['input' => 'array', 'result' => 'array'];
    }
}