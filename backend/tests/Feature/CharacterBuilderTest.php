<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\User;
use App\Support\SvgSanitizer;
use Database\Seeders\LibrarySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CharacterBuilderTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->seed(LibrarySeeder::class);
    }

    private function h(User $u): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$u->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function sys(string $key): LibraryAsset
    {
        return LibraryAsset::where('key', $key)->firstOrFail();
    }

    private function palette(): array
    {
        return ['skin' => '#f1c7a0', 'hair' => '#1f1b24', 'top' => '#f4f6fa', 'bottom' => '#34456a', 'hijab' => '#f1f1f5', 'tie' => '#3f5f86', 'eye' => '#3a2b2b', 'shoe' => '#2b2b33', 'accent' => '#2e3440'];
    }

    private function config(array $parts, string $view = 'half'): array
    {
        return ['schema_version' => 1, 'view' => $view, 'palette' => $this->palette(), 'parts' => $parts];
    }

    private function svgFile(string $content): UploadedFile
    {
        $p = tempnam(sys_get_temp_dir(), 'sv').'.svg';
        file_put_contents($p, $content);

        return new UploadedFile($p, 'a.svg', 'image/svg+xml', null, true);
    }

    // ------------------------------------------------------------------ seeded library & sanitiser

    public function test_seeded_library_has_categories_parts_and_locations_and_is_idempotent(): void
    {
        $u = User::factory()->create();
        $cats = collect($this->getJson('/api/library/categories', $this->h($u))->assertOk()->json('data'));
        $this->assertTrue($cats->contains('slug', 'hijab'));
        $this->assertSame('background', $cats->firstWhere('slug', 'bg_school')['kind']);

        $parts = $this->getJson('/api/library/assets?kind=part', $this->h($u))->json('data');
        $bgs = $this->getJson('/api/library/assets?kind=background', $this->h($u))->json('data');
        $this->assertGreaterThan(40, count($parts));
        $this->assertGreaterThanOrEqual(4, count($bgs));
        $this->assertSame([1280, 720], [$bgs[0]['width'], $bgs[0]['height']]);
        $this->assertTrue(collect($parts)->every(fn ($a) => $a['width'] === 400 && $a['height'] === 800));

        $before = LibraryAsset::count();
        $this->seed(LibrarySeeder::class);
        $this->assertSame($before, LibraryAsset::count());

        $this->assertSame('eyes_round', $this->getJson('/api/library/assets?category=eyes&q=bulat', $this->h($u))->json('data.0.key'));
    }

    public function test_svg_sanitiser_rejects_active_content_and_strips_unknown_attributes(): void
    {
        $ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path d="M0 0L10 10" fill="#fff" onclick="alert(1)" style="x"/></svg>';
        $r = SvgSanitizer::clean($ok);
        $this->assertStringNotContainsString('onclick', $r['svg']);
        $this->assertStringNotContainsString('style', $r['svg']);
        $this->assertSame([400, 800], [$r['width'], $r['height']]);

        foreach ([
            '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>',
            '<svg viewBox="0 0 10 10"><foreignObject><div/></foreignObject></svg>',
            '<svg viewBox="0 0 10 10"><image href="http://evil/x.png"/></svg>',
            '<svg viewBox="0 0 10 10"><path d="M0 0" fill="url(http://evil/x)"/></svg>',
            '<svg viewBox="0 0 10 10"><path d="M0 0" fill="javascript:alert(1)"/></svg>',
            '<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 10 10"/>',
            '<svg><path d="M0 0"/></svg>',                          // no viewBox
            '<svg viewBox="0 0 10 10"><path data-tint="evil" d="M0 0"/></svg>',
            '<html/>',
        ] as $bad) {
            try {
                SvgSanitizer::clean($bad);
                $this->fail('should have been rejected: '.$bad);
            } catch (\RuntimeException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
    }

    // ------------------------------------------------------------------ upload

    public function test_manual_upload_sanitises_svg_validates_raster_and_isolates_users(): void
    {
        $u = User::factory()->create();
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path data-tint="hair" d="M100 100L300 100L200 300Z" fill="#333" onload="x()"/></svg>';
        $r = $this->post('/api/library/assets', ['file' => $this->svgFile($svg), 'category' => 'hat', 'name' => 'Topi saya', 'tags' => 'Topi, Baru , topi'], $this->h($u))->assertCreated();
        $this->assertSame(['topi', 'baru'], $r->json('data.tags'));
        $this->assertTrue($r->json('data.tintable'));
        $stored = Storage::disk('local')->get(LibraryAsset::find($r->json('data.id'))->path);
        $this->assertStringNotContainsString('onload', $stored);

        $this->post('/api/library/assets', ['file' => $this->svgFile('<svg viewBox="0 0 9 9"><script/></svg>'), 'category' => 'hat', 'name' => 'x'], $this->h($u))->assertStatus(422);

        $png = tempnam(sys_get_temp_dir(), 'pn').'.png';
        imagepng(imagecreatetruecolor(50, 60), $png);
        $this->post('/api/library/assets', ['file' => new UploadedFile($png, 'p.png', 'image/png', null, true), 'category' => 'glasses', 'name' => 'PNG'], $this->h($u))->assertCreated()->assertJsonPath('data.width', 50);
        $txt = tempnam(sys_get_temp_dir(), 'tx');
        file_put_contents($txt, 'hello');
        $this->post('/api/library/assets', ['file' => new UploadedFile($txt, 'p.png', 'image/png', null, true), 'category' => 'glasses', 'name' => 'bad'], $this->h($u))->assertStatus(422);

        // other users do not see it; system assets cannot be edited or deleted
        $other = User::factory()->create();
        $this->assertSame([], $this->getJson('/api/library/assets?mine=1', $this->h($other))->json('data'));
        $ids = collect($this->getJson('/api/library/assets?category=hat', $this->h($other))->json('data'))->pluck('name')->all();
        $this->assertNotContains('Topi saya', $ids);
        $this->deleteJson('/api/library/assets/'.$r->json('data.id'), [], $this->h($other))->assertNotFound();
        $this->deleteJson('/api/library/assets/'.$this->sys('hat_cap')->id, [], $this->h($u))->assertNotFound();
        $this->patchJson('/api/library/assets/'.$this->sys('hat_cap')->id, ['name' => 'x'], $this->h($u))->assertNotFound();
    }

    // ------------------------------------------------------------------ AI asset studio

    private function aiConfig(): void
    {
        config(['services.ai.api_key' => 'k', 'services.ai.base_url' => 'http://gateway.test/v1', 'services.ai.model' => 'm']);
    }

    private function reply(string $content): void
    {
        Http::fake(['gateway.test/*' => Http::response(['choices' => [['message' => ['content' => $content]]]])]);
    }

    public function test_ai_asset_is_created_pending_then_approved_and_only_then_usable(): void
    {
        $this->aiConfig();
        $u = User::factory()->create();
        $this->postJson('/api/projects', ['name' => 'P'], $this->h($u));
        $this->reply("```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 800\"><path data-tint=\"hair\" d=\"M120 120L280 120L200 40Z\" fill=\"#222\" stroke=\"#26262e\" stroke-width=\"3\"/></svg>\n```");

        $job = $this->postJson('/api/library/ai/generate', ['category' => 'hat', 'prompt' => 'topi rimba merah'], $this->h($u))->assertStatus(202)->json('data');
        $done = $this->getJson('/api/ai/jobs/'.$job['id'], $this->h($u))->json('data');
        $this->assertSame('done', $done['status'], (string) $done['error']);
        $asset = $done['result']['asset'];
        $this->assertSame(['pending', 'ai', 'hat'], [$asset['status'], $asset['source'], $asset['category']]);
        $this->assertSame('topi rimba merah', $asset['meta']['prompt']);
        Http::assertSent(fn ($r) => str_contains($r->body(), '400x800') || str_contains($r->body(), '0 0 400 800')); // geometry was given to the model

        // pending assets cannot be used in a character
        $parts = ['hat' => ['assetId' => $asset['id']]];
        $this->postJson('/api/builder/characters', ['name' => 'A', 'config' => $this->config($parts)], $this->h($u))->assertStatus(422);

        $this->patchJson('/api/library/assets/'.$asset['id'], ['status' => 'approved'], $this->h($u))->assertOk()->assertJsonPath('data.status', 'approved');
        $this->postJson('/api/builder/characters', ['name' => 'A', 'config' => $this->config($parts)], $this->h($u))->assertCreated();
        // approved assets cannot be flipped to rejected afterwards
        $this->patchJson('/api/library/assets/'.$asset['id'], ['status' => 'rejected'], $this->h($u))->assertStatus(409);
    }

    public function test_ai_output_is_sanitised_repaired_once_and_failures_are_reported(): void
    {
        $this->aiConfig();
        $u = User::factory()->create();
        $this->postJson('/api/projects', ['name' => 'P'], $this->h($u));

        // malicious SVG twice -> job fails, nothing stored
        $this->reply('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><script>alert(1)</script></svg>');
        $job = $this->postJson('/api/library/ai/generate', ['category' => 'hat', 'prompt' => 'topi'], $this->h($u))->json('data');
        $j = $this->getJson('/api/ai/jobs/'.$job['id'], $this->h($u))->json('data');
        $this->assertSame('failed', $j['status']);
        $this->assertStringContainsString('script', $j['error']);
        $this->assertSame(0, LibraryAsset::where('user_id', $u->id)->count());
        Http::assertSentCount(2); // one repair attempt

        // wrong canvas size is rejected too
        $this->reply('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0L9 9"/></svg>');
        $job = $this->postJson('/api/library/ai/generate', ['category' => 'hat', 'prompt' => 'topi 2'], $this->h($u))->json('data');
        $this->assertSame('failed', $this->getJson('/api/ai/jobs/'.$job['id'], $this->h($u))->json('data.status'));
    }

    public function test_ai_generation_without_config_or_over_the_limit(): void
    {
        $u = User::factory()->create();
        $this->postJson('/api/projects', ['name' => 'P'], $this->h($u));
        config(['services.ai.api_key' => null]);
        $this->postJson('/api/library/ai/generate', ['category' => 'hat', 'prompt' => 'topi'], $this->h($u))->assertStatus(503);

        $this->aiConfig();
        config(['services.ai.asset_daily_limit' => 1]);
        $this->reply('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path d="M0 0L9 9"/></svg>');
        $this->postJson('/api/library/ai/generate', ['category' => 'hat', 'prompt' => 'topi'], $this->h($u))->assertStatus(202);
        $this->postJson('/api/library/ai/generate', ['category' => 'hat', 'prompt' => 'topi lagi'], $this->h($u))->assertStatus(429);
    }

    // ------------------------------------------------------------------ characters & versions

    private function baseParts(): array
    {
        return [
            'body' => ['assetId' => $this->sys('body_normal')->id],
            'face' => ['assetId' => $this->sys('face_round')->id],
            'top' => ['assetId' => $this->sys('top_smk_short')->id, 'dx' => 3, 'dy' => -2, 'scale' => 1.05],
            'eyes' => ['assetId' => $this->sys('eyes_round')->id],
        ];
    }

    public function test_character_save_creates_immutable_versions_pinned_to_asset_hashes(): void
    {
        $u = User::factory()->create();
        $thumb = tempnam(sys_get_temp_dir(), 'th').'.png';
        imagepng(imagecreatetruecolor(20, 30), $thumb);

        $c = $this->post('/api/builder/characters', [
            'name' => 'Uki', 'config' => json_encode($this->config($this->baseParts())), 'note' => 'awal',
            'thumbnail' => new UploadedFile($thumb, 't.png', 'image/png', null, true),
        ], $this->h($u))->assertCreated()->json('data');
        $this->assertSame(1, $c['current_version']);
        $this->assertNotNull($c['thumbnail']);
        $v1 = $c['config'];
        $this->assertSame($this->sys('top_smk_short')->hash, $v1['parts']['top']['hash'], 'hash comes from the server, not the client');
        $this->assertSame(1.05, $v1['parts']['top']['scale']);

        // change the character -> a NEW version; v1 stays exactly as it was
        $parts = $this->baseParts();
        $parts['top'] = ['assetId' => $this->sys('top_hoodie')->id];
        $parts['hijab'] = ['assetId' => $this->sys('hijab_basic')->id];
        $r = $this->postJson("/api/builder/characters/{$c['id']}/versions", ['config' => $this->config($parts, 'full'), 'note' => 'hoodie'], $this->h($u))->assertCreated();
        $this->assertSame([2, 1], array_column($r->json('data.versions'), 'number'));

        $old = $this->getJson("/api/builder/characters/{$c['id']}?version=1", $this->h($u))->assertOk()->json('data');
        $this->assertSame($v1, $old['config']);
        $this->assertSame(1, $old['viewing']);
        $this->assertSame('full', $this->getJson("/api/builder/characters/{$c['id']}", $this->h($u))->json('data.config.view'));

        // assets used by a version are archived instead of deleted (old versions keep rendering)
        $mine = $this->post('/api/library/assets', ['file' => $this->svgFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path d="M1 1L9 9" fill="#000"/></svg>'), 'category' => 'hat', 'name' => 'Topi'], $this->h($u))->json('data');
        $this->postJson("/api/builder/characters/{$c['id']}/versions", ['config' => $this->config($this->baseParts() + ['hat' => ['assetId' => $mine['id']]])], $this->h($u))->assertCreated();
        $del = $this->deleteJson('/api/library/assets/'.$mine['id'], [], $this->h($u))->assertOk()->json();
        $this->assertTrue($del['archived']);
        $this->assertNotNull(LibraryAsset::find($mine['id']));
        $v3 = $this->getJson("/api/builder/characters/{$c['id']}?version=3", $this->h($u))->json('data');
        $this->assertArrayHasKey($mine['id'], $v3['assets']);
        $this->assertSame([], collect($this->getJson('/api/library/assets?category=hat&mine=1', $this->h($u))->json('data'))->all(), 'archived assets disappear from the library list');

        // an unused own asset is really deleted
        $tmp = $this->post('/api/library/assets', ['file' => $this->svgFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path d="M1 1L9 9"/></svg>'), 'category' => 'hat', 'name' => 'Tmp'], $this->h($u))->json('data');
        $this->assertFalse($this->deleteJson('/api/library/assets/'.$tmp['id'], [], $this->h($u))->json('archived'));
        $this->assertNull(LibraryAsset::find($tmp['id']));
    }

    public function test_config_validation_and_authorization(): void
    {
        $u = User::factory()->create();
        $other = User::factory()->create();
        $post = fn (array $cfg, ?User $who = null) => $this->postJson('/api/builder/characters', ['name' => 'X', 'config' => $cfg], $this->h($who ?? $u));

        $post($this->config(['unknown_slot' => ['assetId' => $this->sys('eyes_round')->id]]))->assertStatus(422);
        $post($this->config(['mouth' => ['assetId' => $this->sys('eyes_round')->id]]))->assertStatus(422);   // wrong category for the slot
        $post($this->config(['eyes' => ['assetId' => 999999]]))->assertStatus(422);
        $post($this->config(['eyes' => ['assetId' => $this->sys('eyes_round')->id, 'scale' => 99]]))->assertStatus(422);
        $post(['schema_version' => 1, 'view' => 'half', 'palette' => ['skin' => 'red'], 'parts' => []])->assertStatus(422);
        $post($this->config([], 'sideways'))->assertStatus(422);

        // somebody else's private asset cannot be used
        $theirs = $this->post('/api/library/assets', ['file' => $this->svgFile('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 800"><path d="M1 1L9 9"/></svg>'), 'category' => 'hat', 'name' => 'Rahasia'], $this->h($other))->json('data');
        $post($this->config(['hat' => ['assetId' => $theirs['id']]]))->assertStatus(422);

        $c = $post($this->config($this->baseParts()))->assertCreated()->json('data');
        $this->getJson("/api/builder/characters/{$c['id']}", $this->h($other))->assertNotFound();
        $this->postJson("/api/builder/characters/{$c['id']}/versions", ['config' => $this->config($this->baseParts())], $this->h($other))->assertNotFound();
        $this->postJson("/api/builder/characters/{$c['id']}/duplicate", [], $this->h($other))->assertNotFound();
        $this->deleteJson("/api/builder/characters/{$c['id']}", [], $this->h($other))->assertNotFound();
        $this->assertSame([], $this->getJson('/api/builder/characters', $this->h($other))->json('data'));
    }

    public function test_duplicate_rename_delete_and_rig_library_is_separate(): void
    {
        $u = User::factory()->create();
        $c = $this->postJson('/api/builder/characters', ['name' => 'Asli', 'config' => $this->config($this->baseParts())], $this->h($u))->json('data');

        $copy = $this->postJson("/api/builder/characters/{$c['id']}/duplicate", [], $this->h($u))->assertCreated()->json('data');
        $this->assertSame('Asli (salinan)', $copy['name']);
        $this->assertSame($c['config']['parts'], $copy['config']['parts']);
        $this->patchJson("/api/builder/characters/{$copy['id']}", ['name' => 'Budi'], $this->h($u))->assertOk()->assertJsonPath('data.name', 'Budi');
        $this->assertCount(2, $this->getJson('/api/builder/characters', $this->h($u))->json('data'));
        // builder characters do not leak into the earlier rig-layer library
        $this->assertSame([], $this->getJson('/api/characters', $this->h($u))->json('data'));

        $this->deleteJson("/api/builder/characters/{$c['id']}", [], $this->h($u))->assertOk();
        $this->assertCount(1, $this->getJson('/api/builder/characters', $this->h($u))->json('data'));
        // the duplicate still works after the original is gone
        $this->getJson("/api/builder/characters/{$copy['id']}", $this->h($u))->assertOk()->assertJsonPath('data.config.parts.eyes.assetId', $this->sys('eyes_round')->id);
    }

    public function test_library_files_are_served_with_signed_urls_and_safe_headers(): void
    {
        $u = User::factory()->create();
        $a = $this->getJson('/api/library/assets?category=hat', $this->h($u))->json('data.0');
        $this->assertStringStartsWith('/api/library/assets/', $a['url']); // relative: same origin through the dev proxy / nginx
        $r = $this->get($a['url'])->assertOk();
        $this->assertSame('image/svg+xml', $r->headers->get('Content-Type'));
        $this->assertStringContainsString('sandbox', $r->headers->get('Content-Security-Policy'));
        $this->assertSame('nosniff', $r->headers->get('X-Content-Type-Options'));
        $this->get('/api/library/assets/'.$a['id'].'/file')->assertStatus(403); // unsigned
    }

    public function test_layering_overrides_are_validated_and_stored_in_the_version(): void
    {
        $u = User::factory()->create();
        $parts = $this->baseParts();
        $parts['top']['z'] = 7.5;
        $parts['eyes']['split'] = 320.4;
        $c = $this->postJson('/api/builder/characters', ['name' => 'Z', 'config' => $this->config($parts)], $this->h($u))->assertCreated()->json('data');
        $this->assertSame(7.5, $c['config']['parts']['top']['z']);
        $this->assertSame(320.4, $c['config']['parts']['eyes']['split']);
        $this->assertArrayNotHasKey('z', $c['config']['parts']['face']);
        $this->assertArrayNotHasKey('split', $c['config']['parts']['face']);

        foreach ([['z', 99], ['z', -9], ['split', 50], ['split', 900]] as [$k, $v]) {
            $bad = $this->baseParts();
            $bad['top'][$k] = $v;
            $this->postJson('/api/builder/characters', ['name' => 'Bad', 'config' => $this->config($bad)], $this->h($u))->assertStatus(422);
        }
        // older versions without the fields keep working
        $plain = $this->postJson("/api/builder/characters/{$c['id']}/versions", ['config' => $this->config($this->baseParts())], $this->h($u))->assertCreated()->json('data');
        $this->assertArrayNotHasKey('z', $plain['config']['parts']['top']);
    }

    public function test_raster_recolouring_fields_are_validated_and_stored(): void
    {
        $u = User::factory()->create();
        $parts = $this->baseParts();
        $parts['top'] += ['tint' => '#A9A4A4', 'tintAmount' => 0.75, 'brightness' => 1.4];
        $parts['eyes']['brightness'] = 1.0; // the default is not stored
        $c = $this->postJson('/api/builder/characters', ['name' => 'W', 'config' => $this->config($parts)], $this->h($u))->assertCreated()->json('data');
        $this->assertSame(['tint' => '#a9a4a4', 'tintAmount' => 0.75, 'brightness' => 1.4], array_intersect_key($c['config']['parts']['top'], array_flip(['tint', 'tintAmount', 'brightness'])));
        $this->assertArrayNotHasKey('brightness', $c['config']['parts']['eyes']);
        $this->assertArrayNotHasKey('tint', $c['config']['parts']['face']);

        foreach ([['tint', 'red'], ['tint', '#12345'], ['tintAmount', 1.5], ['tintAmount', -1], ['brightness', 0.1], ['brightness', 9]] as [$k, $v]) {
            $bad = $this->baseParts();
            $bad['top'][$k] = $v;
            $this->postJson('/api/builder/characters', ['name' => 'Bad', 'config' => $this->config($bad)], $this->h($u))->assertStatus(422);
        }
    }

    public function test_rotation_is_validated_and_stored_only_when_it_is_not_zero(): void
    {
        $u = User::factory()->create();
        $parts = $this->baseParts();
        $parts['top']['rot'] = -37.456;
        $parts['eyes']['rot'] = 0;
        $parts['face']['rot'] = 0.004; // effectively zero
        $c = $this->postJson('/api/builder/characters', ['name' => 'R', 'config' => $this->config($parts)], $this->h($u))->assertCreated()->json('data');
        $this->assertSame(-37.46, $c['config']['parts']['top']['rot']);
        $this->assertArrayNotHasKey('rot', $c['config']['parts']['eyes']);
        $this->assertArrayNotHasKey('rot', $c['config']['parts']['face']);

        foreach ([721, -721, 'abc'] as $v) {
            $bad = $this->baseParts();
            $bad['top']['rot'] = $v;
            $this->postJson('/api/builder/characters', ['name' => 'Bad', 'config' => $this->config($bad)], $this->h($u))->assertStatus(422);
        }
    }

    public function test_saved_expressions_are_validated_hashed_and_pin_their_assets_to_the_version(): void
    {
        $u = User::factory()->create();
        $h = $this->h($u);
        $senang = ['eyes' => ['assetId' => $this->sys('eyes_happy')->id, 'dx' => 1], 'mouth' => ['assetId' => $this->sys('mouth_open')->id, 'rot' => 5]];
        $cfg = $this->config($this->baseParts()) + ['expressions' => [['id' => 'senang', 'name' => 'Senang', 'parts' => $senang]]];
        $c = $this->postJson('/api/builder/characters', ['name' => 'E', 'config' => $cfg], $h)->assertCreated()->json('data');
        $e = $c['config']['expressions'][0];
        $this->assertSame('senang', $e['id']);
        $this->assertSame($this->sys('eyes_happy')->hash, $e['parts']['eyes']['hash']);
        $this->assertEquals(1, $e['parts']['eyes']['dx']);
        $this->assertEquals(5, $e['parts']['mouth']['rot']);
        $this->assertArrayHasKey($this->sys('mouth_open')->id, $c['assets'], 'expression assets are delivered with the character');

        // the expression's assets are pinned: deleting one only archives it
        $asset = $this->sys('eyes_happy');
        $asset->update(['user_id' => $u->id, 'source' => 'upload']);
        $this->deleteJson('/api/library/assets/'.$asset->id, [], $h)->assertOk()->assertJsonPath('archived', true);
        $this->assertNotNull($asset->fresh()->archived_at, 'archived, not deleted');

        $bad = [
            [['id' => 'x', 'name' => 'X', 'parts' => ['face' => ['assetId' => $this->sys('face_round')->id]]]], // only eyes/brows/mouth
            [['id' => 'x', 'name' => 'X', 'parts' => ['eyes' => ['assetId' => $this->sys('mouth_open')->id]]]], // wrong category
            [['id' => 'X Y', 'name' => 'X', 'parts' => ['eyes' => ['assetId' => $this->sys('eyes_round')->id]]]], // bad id
            [['id' => 'a', 'name' => 'A', 'parts' => ['eyes' => ['assetId' => $this->sys('eyes_round')->id]]], ['id' => 'a', 'name' => 'B', 'parts' => ['eyes' => ['assetId' => $this->sys('eyes_round')->id]]]], // duplicate id
        ];
        foreach ($bad as $i => $expr) {
            $this->postJson('/api/builder/characters', ['name' => 'Bad', 'config' => $this->config($this->baseParts()) + ['expressions' => $expr]], $h)->assertStatus(422, "case $i");
        }
    }

    public function test_traced_svg_from_an_image_is_accepted_by_the_library_upload(): void
    {
        $u = User::factory()->create();
        $svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">'
            .'<path fill="#ff0010" stroke="#ff0010" stroke-width="1" stroke-linejoin="round" fill-rule="evenodd" d="M 0 0 L 5.5 0 Q 6 7 5.5 5 Z M 1 1 L 2 1 L 2 2 Z"/>'
            .'<path fill="#010203" d="M 10 10 L 20 10 L 20 20 Z"/></svg>';
        $r = $this->post('/api/library/assets', ['file' => $this->svgFile($svg), 'category' => 'accessory', 'name' => 'Hasil trace', 'tags' => 'trace'], $this->h($u))->assertCreated();
        $this->assertSame('image/svg+xml', $r->json('data.mime'));
        $this->assertSame([640, 480], [$r->json('data.width'), $r->json('data.height')]);
        $stored = Storage::disk('local')->get(LibraryAsset::find($r->json('data.id'))->path);
        $this->assertStringContainsString('fill-rule="evenodd"', $stored);
        $this->assertStringContainsString('stroke-linejoin="round"', $stored);
        $this->assertSame(2, substr_count($stored, '<path'));

        // over the size limit it is refused with a clear message (a high-detail trace can be big)
        $big = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0 L1 1 '.str_repeat('L 2.5 3.5 ', 40000).'Z"/></svg>';
        $this->post('/api/library/assets', ['file' => $this->svgFile($big), 'category' => 'accessory', 'name' => 'Besar'], $this->h($u))->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, '300'));
    }
}
