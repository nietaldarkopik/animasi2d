<?php

namespace App\Http\Controllers;

use App\Models\Character;
use App\Models\Project;
use App\Services\DailyCartoonService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DailyCartoonController extends Controller
{
    public function __construct(protected DailyCartoonService $service) {}

    public function status(Request $request): JsonResponse
    {
        $user = $request->user();
        $todayStr = date('Y-m-d');

        $todayProject = Project::where('user_id', $user->id)
            ->where('name', 'like', "%{$todayStr}%")
            ->orderByDesc('id')
            ->first();

        $history = Project::where('user_id', $user->id)
            ->where('name', 'like', 'Kartun Harian%')
            ->orderByDesc('id')
            ->limit(10)
            ->get()
            ->map(function ($p) {
                $latestExport = $p->exports()->orderByDesc('id')->first();
                return [
                    'id' => $p->id,
                    'name' => $p->name,
                    'created_at' => $p->created_at,
                    'scenes_count' => count($p->document['scenes'] ?? []),
                    'has_export' => (bool) $latestExport,
                    'export_status' => $latestExport?->status,
                    'export_id' => $latestExport?->id,
                ];
            });

        $characters = Character::where('user_id', $user->id)
            ->where('kind', 'builder')
            ->pluck('name')
            ->unique()
            ->values();

        return response()->json([
            'today' => $todayStr,
            'today_project' => $todayProject ? [
                'id' => $todayProject->id,
                'name' => $todayProject->name,
                'created_at' => $todayProject->created_at,
            ] : null,
            'history' => $history,
            'characters' => $characters->isNotEmpty() ? $characters : ['Sekar', 'Uki'],
        ]);
    }

    public function generate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'topic' => 'nullable|string|max:200',
            'characters' => 'nullable|array|min:1|max:4',
            'characters.*' => 'string|max:50',
        ]);

        $chars = !empty($data['characters']) ? $data['characters'] : ['Sekar', 'Uki'];
        $res = $this->service->createDailyCartoon($request->user()->id, $data['topic'] ?? null, $chars);

        return response()->json(['data' => $res], 201);
    }
}
