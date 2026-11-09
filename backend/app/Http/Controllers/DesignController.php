<?php

namespace App\Http\Controllers;

use App\Services\Library\DesignFamily;
use App\Services\Library\DesignTemplate;
use Illuminate\Http\JsonResponse;

/** The design standard as the clients need it: which template, which design families exist, and which of them fit together. */
class DesignController extends Controller
{
    public function template(): JsonResponse
    {
        $t = DesignTemplate::load();

        return response()->json(['data' => [
            'id' => $t->id(),
            'label' => $t->data['label'],
            'views' => $t->data['views'],
            'tolerance' => $t->data['anchor_tolerance'] ?? null,
            'families' => DesignFamily::all(),
        ]]);
    }

    /** The design templates that exist (character family / proportion preset), for choosing one when building a character. */
    public function templates(): JsonResponse
    {
        $out = [];
        foreach (glob(resource_path('design/*.json')) ?: [] as $f) {
            $d = json_decode((string) file_get_contents($f), true);
            if (isset($d['id'])) {
                $out[] = ['id' => $d['id'], 'label' => $d['label'] ?? $d['id'], 'preset' => $d['preset'] ?? null];
            }
        }

        return response()->json(['data' => $out]);
    }
}
