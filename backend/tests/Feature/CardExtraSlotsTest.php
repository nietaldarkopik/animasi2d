<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Card characters (karakter/<name>/) with spec v2 slots ("extra": sitting, 3/4 and side views, ...) and the rig data the editor stores per layer. */
class CardExtraSlotsTest extends TestCase
{
    use RefreshDatabase;

    /** @var string[] */
    private array $made = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        foreach ($this->made as $dir) {
            File::deleteDirectory($dir);
        }
        parent::tearDown();
    }

    private function headers(): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.User::factory()->create()->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function png(string $path, int $w, int $h): void
    {
        $im = imagecreatetruecolor($w, $h);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
        imagefilledrectangle($im, 1, 1, max(1, $w - 2), max(1, $h - 2), imagecolorallocate($im, 200, 40, 40));
        imagepng($im, $path);
    }

    /** A tiny character folder under karakter/; returns its slug. */
    private function character(array $extra = [], array $metaOverride = []): string
    {
        $slug = 'zz-test-'.bin2hex(random_bytes(4));
        $dir = base_path('..'.DIRECTORY_SEPARATOR.'karakter'.DIRECTORY_SEPARATOR.$slug);
        File::makeDirectory($dir, 0777, true);
        $this->made[] = $dir;
        $meta = [
            'name' => $slug,
            'body' => ['canvas' => [8, 14], 'feet_y' => 12, 'center_x' => 4, 'poses' => ['diam'], 'file' => $slug.'_badan_<pose>.png'],
            'head' => ['canvas' => [4, 5], 'paste_on_body' => [2, 0], 'expressions' => ['netral'], 'file' => $slug.'_kepala_<ekspresi>.png'],
        ] + ($extra ? ['extra' => $extra] : []);
        file_put_contents($dir.DIRECTORY_SEPARATOR.'character.json', json_encode(array_replace_recursive($meta, $metaOverride)));
        $this->png($dir.DIRECTORY_SEPARATOR.$slug.'_badan_diam.png', 8, 14);
        $this->png($dir.DIRECTORY_SEPARATOR.$slug.'_kepala_netral.png', 4, 5);
        foreach ($extra as $files) {
            foreach ($files as $f) {
                $this->png($dir.DIRECTORY_SEPARATOR.$f, 8, 14);
            }
        }

        return $slug;
    }

    public function test_extra_slots_are_imported_served_and_downloadable(): void
    {
        $h = $this->headers();
        $slug = $this->character(['body' => ['duduk_tegak' => 'zz_duduk_tegak.png', 'diam_34' => 'zz_diam_34.png'], 'head' => ['netral_34' => 'zz_netral_34.png']]);
        $r = $this->postJson('/api/builder/cards', ['slug' => $slug], $h)->assertCreated();

        $urls = $r->json('data.urls');
        $this->assertSame(['duduk_tegak', 'diam_34'], array_keys($urls['extra']['body']));
        $this->assertSame(['netral_34'], array_keys($urls['extra']['head']));
        $this->assertArrayNotHasKey('mouth', $urls['extra']);
        $this->assertSame(['body' => ['duduk_tegak' => 'zz_duduk_tegak.png', 'diam_34' => 'zz_diam_34.png'], 'head' => ['netral_34' => 'zz_netral_34.png']], $r->json('data.meta.extra'));
        $this->assertSame(['diam'], array_keys($urls['body']), 'the base poses are untouched');

        $file = $this->get($urls['extra']['body']['duduk_tegak'])->assertOk();
        $this->assertSame('image/png', $file->headers->get('Content-Type'));
        $id = $r->json('data.id');
        $this->postJson("/api/builder/cards/$id/duplicate", [], $h)->assertCreated()->assertJsonPath('data.urls.extra.body.diam_34', fn ($u) => is_string($u) && $u !== '');
    }

    public function test_a_card_without_extra_has_no_extra_urls(): void
    {
        $h = $this->headers();
        $r = $this->postJson('/api/builder/cards', ['slug' => $this->character()], $h)->assertCreated();
        $this->assertArrayNotHasKey('extra', $r->json('data.urls'));
    }

    public function test_available_lists_the_enabled_packs(): void
    {
        $h = $this->headers();
        $slug = $this->character([], ['spec' => ['version' => 2, 'packs' => ['dasar', 'duduk']]]);
        $row = collect($this->getJson('/api/builder/cards/available', $h)->assertOk()->json('data'))->firstWhere('slug', $slug);
        $this->assertSame(['dasar', 'duduk'], $row['packs']);
    }

    public function test_extra_slot_with_a_missing_file_or_bad_name_is_refused(): void
    {
        $h = $this->headers();
        $slug = $this->character(['body' => ['duduk_tegak' => 'zz_duduk_tegak.png']]);
        unlink(base_path('..'.DIRECTORY_SEPARATOR.'karakter'.DIRECTORY_SEPARATOR.$slug.DIRECTORY_SEPARATOR.'zz_duduk_tegak.png'));
        $this->postJson('/api/builder/cards', ['slug' => $slug], $h)->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'extra.body.duduk_tegak'));

        $slug2 = $this->character();
        $meta = json_decode(file_get_contents(base_path('..'.DIRECTORY_SEPARATOR.'karakter'.DIRECTORY_SEPARATOR.$slug2.DIRECTORY_SEPARATOR.'character.json')), true);
        $meta['extra'] = ['body' => ['../x' => 'zz_a.png']];
        file_put_contents(base_path('..'.DIRECTORY_SEPARATOR.'karakter'.DIRECTORY_SEPARATOR.$slug2.DIRECTORY_SEPARATOR.'character.json'), json_encode($meta));
        $this->postJson('/api/builder/cards', ['slug' => $slug2], $h)->assertStatus(422);
        $meta['extra'] = ['body' => ['ok_id' => '../../etc.png']];
        file_put_contents(base_path('..'.DIRECTORY_SEPARATOR.'karakter'.DIRECTORY_SEPARATOR.$slug2.DIRECTORY_SEPARATOR.'character.json'), json_encode($meta));
        $this->postJson('/api/builder/cards', ['slug' => $slug2], $h)->assertStatus(422);
    }

    private function layer(string $id, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'bone', 'name' => $id, 'x' => 1, 'y' => 2, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false];
    }

    private function doc(array $layers): array
    {
        return ['schema' => 2, 'settings' => ['width' => 1280, 'height' => 720, 'fps' => 24],
            'scenes' => [['id' => 's1', 'name' => 'S1', 'duration' => 3, 'background' => '#ffffff', 'layers' => $layers]], 'audio' => []];
    }

    public function test_layers_keep_card_rig_data_and_many_expression_images(): void
    {
        $h = $this->headers();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $expr = [];
        for ($i = 0; $i < 60; $i++) {
            $expr["pose_$i"] = 100 + $i;
        }
        $card = ['head0' => [0, -52.5], 'head' => ['duduk_sila' => [3, -40], 'lari_sisi' => [-2.5, 7]], 'mirror' => true, 'junk' => 'x'];
        $r = $this->putJson("/api/projects/$pid", ['document' => $this->doc([
            $this->layer('root', ['rig' => ['id' => 'r1', 'role' => 'bone:root', 'card' => $card]]),
            $this->layer('body', ['type' => 'shape', 'expr' => $expr, 'rig' => ['id' => 'r1', 'role' => 'piece:card_body']]),
        ])], $h)->assertOk();
        $layers = $r->json('data.document.scenes.0.layers');
        $this->assertEquals([0, -52.5], $layers[0]['rig']['card']['head0']);
        $this->assertEquals([3, -40], $layers[0]['rig']['card']['head']['duduk_sila']);
        $this->assertTrue($layers[0]['rig']['card']['mirror']);
        $this->assertArrayNotHasKey('junk', $layers[0]['rig']['card'], 'unknown card keys are dropped');
        $this->assertCount(60, $layers[1]['expr']);

        foreach ([['head' => ['a' => [1, 2, 3]]], ['head0' => [1]], ['head' => ['a' => ['x', 2]]], ['mirror' => 'ya']] as $i => $bad) {
            $this->putJson("/api/projects/$pid", ['document' => $this->doc([$this->layer('root', ['rig' => ['id' => 'r1', 'role' => 'bone:root', 'card' => $bad]])])], $h)->assertStatus(422, "case $i");
        }
    }
}
