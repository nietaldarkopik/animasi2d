<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AssetCategory extends Model
{
    public $timestamps = false;

    protected $fillable = ['slug', 'name', 'kind', 'z_order', 'sort'];
}
