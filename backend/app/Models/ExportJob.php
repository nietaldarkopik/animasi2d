<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ExportJob extends Model
{
    protected $table = 'render_jobs';

    protected function casts(): array
    {
        return ['audio' => 'array', 'options' => 'array'];
    }

    protected $fillable = ['project_id', 'user_id', 'format', 'width', 'height', 'fps', 'status', 'source_path', 'output_path', 'error', 'audio', 'options'];
}
