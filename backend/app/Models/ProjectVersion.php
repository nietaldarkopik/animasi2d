<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProjectVersion extends Model
{
    protected $fillable = ['project_id', 'number', 'label', 'document'];

    protected function casts(): array
    {
        return ['document' => 'array'];
    }
}
