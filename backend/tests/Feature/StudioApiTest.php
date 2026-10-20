<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class StudioApiTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function bearer(?User $u = null): array
    {
        $this->app['auth']->forgetGuards(); // guards cache the user across requests in one test process
        return ['Authorization' => 'Bearer '.($u ?? User::factory()->create())->createToken('t')->plainTextToken, 'Accept' => 'application/json'];
    }

    public function test_register_and_login(): void
    {
        $this->postJson('/api/auth/register', ['name' => 'A', 'email' => 'a@x.test', 'password' => 'password123'])->assertCreated();
        $this->postJson('/api/auth/login', ['email' => 'a@x.test', 'password' => 'password123'])->assertOk()->assertJsonStructure(['token']);
        $this->postJson('/api/auth/login', ['email' => 'a@x.test', 'password' => 'bad'])->assertStatus(422);
    }

    public function test_auth_required_and_projects_isolated(): void
    {
        $this->getJson('/api/projects')->assertUnauthorized();
        $h1 = $this->bearer();
        $id = $this->postJson('/api/projects', ['name' => 'P'], $h1)->assertCreated()->assertJsonPath('data.revision', 1)->json('data.id');
        $this->getJson("/api/projects/$id", $this->bearer())->assertNotFound();
        $this->app['auth']->forgetGuards();
        $this->getJson("/api/projects/$id", $h1)->assertOk();
    }

    public function test_save_versions_restore_duplicate_delete(): void
    {
        $h = $this->bearer();
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        $doc = $p['document'];
        $doc['scenes'][0]['layers'][] = ['id' => 'l1', 'type' => 'text', 'name' => 'Hi', 'text' => 'Hi', 'x' => 10.5, 'y' => 20, 'scaleX' => 1, 'scaleY' => 2, 'rotation' => 45, 'opacity' => 0.5, 'visible' => true, 'locked' => false, 'fontSize' => 32, 'fill' => '#112233', 'keyframes' => ['x' => [['f' => 0, 'v' => 1, 'e' => 'easeIn'], ['f' => 24, 'v' => 99.5, 'e' => 'linear']]]];

        $this->putJson("/api/projects/{$p['id']}", ['document' => $doc, 'base_revision' => 1, 'snapshot' => true], $h)
            ->assertOk()->assertJsonPath('data.revision', 2);
        $saved = $this->getJson("/api/projects/{$p['id']}", $h)->json('data.document.scenes.0.layers.0');
        $this->assertEquals($doc['scenes'][0]['layers'][0], $saved, 'all layer fields must round-trip');
        $bad = $doc; $bad['scenes'][0]['layers'][0]['keyframes']['x'][0]['e'] = 'bogus';
        $this->putJson("/api/projects/{$p['id']}", ['document' => $bad, 'base_revision' => 2], $h)->assertStatus(422);
        $this->putJson("/api/projects/{$p['id']}", ['document' => $doc, 'base_revision' => 1], $h)->assertStatus(409);
        $this->putJson("/api/projects/{$p['id']}", ['document' => ['settings' => ['width' => 10]]], $h)->assertStatus(422);

        $this->getJson("/api/projects/{$p['id']}/versions", $h)->assertJsonCount(1, 'data');
        $this->postJson("/api/projects/{$p['id']}/versions/1/restore", [], $h)->assertOk()
            ->assertJsonPath('data.document.scenes.0.layers.0.id', 'l1');

        $dup = $this->postJson("/api/projects/{$p['id']}/duplicate", [], $h)->assertCreated()->json('data');
        $this->assertNotSame($p['id'], $dup['id']);
        $this->deleteJson("/api/projects/{$p['id']}", [], $h)->assertOk();
        $this->getJson('/api/projects', $h)->assertJsonCount(1, 'data');
    }

    public function test_upload_validates_and_serves_signed(): void
    {
        $h = $this->bearer();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');

        $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->create('x.png', 5, 'image/png')], $h)->assertStatus(422);
        $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->createWithContent('x.txt', 'hello')], $h)->assertStatus(422);

        $a = $this->post("/api/projects/$pid/assets", ['file' => UploadedFile::fake()->image('ok.png', 40, 30)], $h)
            ->assertCreated()->json('data');
        $this->assertSame(40, $a['width']);
        $this->get($a['url'])->assertOk();
        $this->get('/api/assets/'.$a['id'].'/file')->assertStatus(403);
    }

    public function test_layers_stay_an_ordered_list_when_only_later_layers_have_keyframes(): void
    {
        $h = $this->bearer();
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        $mk = fn (string $id, array $extra = []) => ['id' => $id, 'type' => 'shape', 'name' => $id, 'x' => 0, 'y' => 0, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false] + $extra;
        $doc = $p['document'];
        $doc['scenes'][0]['layers'] = [$mk('a'), $mk('b', ['keyframes' => ['x' => [['f' => 10, 'v' => 1, 'e' => 'linear'], ['f' => 0, 'v' => 0, 'e' => 'linear']]]]), $mk('c')];
        $saved = $this->putJson("/api/projects/{$p['id']}", ['document' => $doc], $h)->assertOk()->json('data.document.scenes.0.layers');
        $this->assertTrue(array_is_list($saved));
        $this->assertSame(['a', 'b', 'c'], array_column($saved, 'id'));
    }

    public function test_hierarchy_is_validated(): void
    {
        $h = $this->bearer();
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        $mk = fn (string $id, ?string $parent) => ['id' => $id, 'type' => 'bone', 'name' => $id, 'x' => 0, 'y' => 0, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false, 'parentId' => $parent, 'length' => 100, 'pivotX' => 0, 'pivotY' => 0];
        $doc = $p['document'];
        $doc['scenes'][0]['layers'] = [$mk('a', null), $mk('b', 'a')];
        $this->putJson("/api/projects/{$p['id']}", ['document' => $doc], $h)->assertOk()->assertJsonPath('data.document.scenes.0.layers.1.parentId', 'a');
        $doc['scenes'][0]['layers'] = [$mk('a', 'b'), $mk('b', 'a')];
        $this->putJson("/api/projects/{$p['id']}", ['document' => $doc], $h)->assertStatus(422);
        $doc['scenes'][0]['layers'] = [$mk('a', 'zzz')];
        $this->putJson("/api/projects/{$p['id']}", ['document' => $doc], $h)->assertStatus(422);
    }

    public function test_ik_references_are_validated(): void
    {
        $h = $this->bearer();
        $p = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data');
        $mk = fn (string $id, ?string $parent, ?array $ik = null) => ['id' => $id, 'type' => 'bone', 'name' => $id, 'x' => 0, 'y' => 0, 'scaleX' => 1, 'scaleY' => 1, 'rotation' => 0, 'opacity' => 1, 'visible' => true, 'locked' => false, 'parentId' => $parent, 'ik' => $ik];
        $put = fn (array $layers) => $this->putJson("/api/projects/{$p['id']}", ['document' => ['settings' => $p['document']['settings'], 'layers' => $layers]], $h);
        $put([$mk('a', null), $mk('b', 'a', ['target' => 'g', 'bend' => 1]), $mk('g', null)])->assertOk()->assertJsonPath('data.document.scenes.0.layers.1.ik.target', 'g');
        $put([$mk('a', null), $mk('b', 'a', ['target' => 'zzz', 'bend' => 1])])->assertStatus(422);
        $put([$mk('a', null), $mk('b', 'a', ['target' => 'b', 'bend' => 1])])->assertStatus(422);
        $put([$mk('a', null), $mk('b', null, ['target' => 'a', 'bend' => 1])])->assertStatus(422);
        $put([$mk('a', null), $mk('b', 'a', ['target' => 'c', 'bend' => 1]), $mk('c', 'b')])->assertStatus(422);
        $put([$mk('a', null), $mk('g', null), $mk('b', 'a', ['target' => 'g', 'bend' => 2])])->assertStatus(422);
    }

    private function makeAsset(array $h, int $pid, callable $draw, int $w = 300, int $h2 = 200): array
    {
        $im = imagecreatetruecolor($w, $h2);
        $draw($im);
        $tmp = tempnam(sys_get_temp_dir(), 'img').'.png';
        imagepng($im, $tmp);
        $r = $this->post("/api/projects/$pid/assets", ['file' => new UploadedFile($tmp, 'src.png', 'image/png', null, true)], $h)->assertCreated();

        return $r->json('data');
    }

    private function fetchPng(array $asset)
    {
        $id = $asset['id'];
        $path = \App\Models\Asset::find($id)->path;

        return imagecreatefrompng(Storage::disk('local')->path($path));
    }

    public function test_image_processing_worker(): void
    {
        $h = $this->bearer();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');

        // blue disc on beige background
        $subject = $this->makeAsset($h, $pid, function ($im) {
            imagefill($im, 0, 0, imagecolorallocate($im, 236, 226, 200));
            imagefilledellipse($im, 150, 100, 120, 120, imagecolorallocate($im, 30, 90, 200));
        });

        // crop + resize
        $r = $this->postJson("/api/assets/{$subject['id']}/process", ['ops' => [['op' => 'crop', 'x' => 50, 'y' => 0, 'w' => 200, 'h' => 200], ['op' => 'resize', 'width' => 100]]], $h)->assertCreated();
        $this->assertSame([100, 100], [$r->json('data.width'), $r->json('data.height')]);

        // remove background + trim: corners transparent, centre opaque, tight bounds
        $r = $this->postJson("/api/assets/{$subject['id']}/process", ['ops' => [['op' => 'remove_bg', 'tolerance' => 25], ['op' => 'trim']]], $h)->assertCreated();
        $this->assertEqualsWithDelta(124, $r->json('data.width'), 6);
        $png = $this->fetchPng($r->json('data'));
        $this->assertSame(0, (imagecolorat($png, 0, 0) >> 24) & 0x7F ? 0 : 1, 'corner must be transparent (GD alpha 127)');
        $this->assertSame(0, (imagecolorat($png, intdiv(imagesx($png), 2), intdiv(imagesy($png), 2)) >> 24) & 0x7F, 'centre must be opaque');

        // dark pen lines on unevenly lit paper -> transparent line art
        $paper = $this->makeAsset($h, $pid, function ($im) {
            for ($x = 0; $x < 300; $x++) {
                $v = 255 - (int) ($x / 300 * 60);
                imageline($im, $x, 0, $x, 199, imagecolorallocate($im, $v, $v, $v));
            }
            imagesetthickness($im, 4);
            imageline($im, 20, 100, 280, 100, imagecolorallocate($im, 20, 20, 20));
        });
        $r = $this->postJson("/api/assets/{$paper['id']}/process", ['ops' => [['op' => 'sketch', 'strength' => 50]]], $h)->assertCreated();
        $png = $this->fetchPng($r->json('data'));
        $this->assertGreaterThan(100, (imagecolorat($png, 150, 100) >> 24) & 0x7F ? 0 : 200, 'line pixel opaque');
        $this->assertSame(127, (imagecolorat($png, 150, 30) >> 24) & 0x7F, 'paper must be fully transparent');

        // errors: undetectable background, missing params, foreign user, unknown op
        $flat = $this->makeAsset($h, $pid, fn ($im) => imagefill($im, 0, 0, imagecolorallocate($im, 200, 200, 200)));
        $this->postJson("/api/assets/{$flat['id']}/process", ['ops' => [['op' => 'remove_bg', 'tolerance' => 30]]], $h)->assertStatus(422); // all background
        $this->postJson("/api/assets/{$flat['id']}/process", ['ops' => [['op' => 'sketch', 'strength' => 50]]], $h)->assertStatus(422); // no lines
        $this->postJson("/api/assets/{$paper['id']}/process", ['ops' => [['op' => 'crop', 'x' => 1]]], $h)->assertStatus(422);
        $this->postJson("/api/assets/{$paper['id']}/process", ['ops' => [['op' => 'nuke']]], $h)->assertStatus(422);
        $this->postJson("/api/assets/{$paper['id']}/process", ['ops' => [['op' => 'crop', 'x' => 9000, 'y' => 0, 'w' => 10, 'h' => 10]]], $h)->assertStatus(422);
        $this->postJson("/api/assets/{$paper['id']}/process", ['ops' => [['op' => 'trim']]], $this->bearer())->assertNotFound();
    }

    public static function formats(): array
    {
        return [['mp4'], ['webm'], ['png_sequence']];
    }

    #[DataProvider('formats')]
    public function test_export_runs_through_ffmpeg(string $format): void
    {
        $dir = sys_get_temp_dir().'/anim_'.uniqid();
        mkdir($dir);
        $src = $dir.'/in.webm';
        $p = new Process([config('services.ffmpeg.bin'), '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1:r=10', '-c:v', 'libvpx', $src]);
        $p->run();
        if (! $p->isSuccessful()) {
            $this->markTestSkipped('ffmpeg unavailable: '.$p->getErrorOutput());
        }

        $h = $this->bearer();
        $pid = $this->postJson('/api/projects', ['name' => 'P'], $h)->json('data.id');
        $r = $this->post("/api/projects/$pid/exports", [
            'format' => $format, 'width' => 160, 'height' => 90, 'fps' => 10,
            'file' => new UploadedFile($src, 'in.webm', 'video/webm', null, true),
        ], $h)->assertStatus(202);

        // QUEUE_CONNECTION=sync in tests, so the job has already run.
        $s = $this->getJson('/api/exports/'.$r->json('data.id'), $h)->assertOk();
        $this->assertSame('done', $s->json('data.status'), (string) $s->json('data.error'));
        $this->get('/api/exports/'.$r->json('data.id').'/download', $h)->assertOk();
        $this->assertFalse(Storage::disk('local')->exists(\App\Models\ExportJob::find($r->json('data.id'))->source_path), 'raw recording is deleted after a successful export');
    }
}
