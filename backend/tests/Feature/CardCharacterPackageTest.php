<?php

namespace Tests\Feature;

use App\Models\Character;
use App\Models\CharacterVersion;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

class CardCharacterPackageTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        if (! class_exists(ZipArchive::class)) {
            $this->markTestSkipped('PHP ZipArchive extension is required.');
        }
    }

    private function auth(User $user): array
    {
        return ['Authorization' => 'Bearer '.$user->createToken('card-package-test')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function pngBytes(): string
    {
        $image = imagecreatetruecolor(24, 32);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
        ob_start();
        imagepng($image);
        $bytes = (string) ob_get_clean();
        imagedestroy($image);

        return $bytes;
    }

    private function packageFile(): UploadedFile
    {
        $meta = [
            'name' => 'Jacky Edit',
            'body' => ['canvas' => [24, 32], 'feet_y' => 32, 'center_x' => 12, 'poses' => ['diam'], 'file' => 'unused_<pose>.png'],
            'head' => ['canvas' => [12, 12], 'paste_on_body' => [6, 2], 'expressions' => ['netral'], 'file' => 'unused_<ekspresi>.png'],
        ];
        $files = ['body' => ['diam' => 'body_diam.png'], 'head' => ['netral' => 'head_netral.png'], 'mouth' => [], 'blink' => null];
        $manifest = ['format' => 'animasi2d.character-card-package', 'format_version' => 1, 'character' => ['name' => 'Jacky'], 'meta' => $meta, 'files' => $files];
        $path = tempnam(sys_get_temp_dir(), 'card-package-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::OVERWRITE);
        $zip->addFromString('character.json', json_encode($manifest));
        $zip->addFromString('assets/body_diam.png', $this->pngBytes());
        $zip->addFromString('assets/head_netral.png', $this->pngBytes());
        $zip->close();

        return new UploadedFile($path, 'jacky-edited.zip', 'application/zip', null, true);
    }

    public function test_it_imports_an_edited_package_as_a_new_card_character_without_replacing_the_source(): void
    {
        $user = User::factory()->create();
        $source = Character::create(['user_id' => $user->id, 'kind' => 'card', 'name' => 'Jacky', 'method' => 'rig', 'current_version' => 1]);

        $response = $this->withHeaders($this->auth($user))->post('/api/builder/cards/import-package', [
            'file' => $this->packageFile(),
        ]);

        $response->assertCreated()->assertJsonPath('data.name', 'Jacky (impor)')->assertJsonPath('data.current_version', 1);
        $this->assertDatabaseCount('characters', 2);
        $this->assertDatabaseHas('characters', ['id' => $source->id, 'name' => 'Jacky', 'current_version' => 1]);
        $this->assertDatabaseHas('characters', ['name' => 'Jacky (impor)', 'kind' => 'card']);
        $version = CharacterVersion::where('character_id', '!=', $source->id)->firstOrFail();
        Storage::disk('local')->assertExists($version->config['dir'].'/body_diam.png');
        Storage::disk('local')->assertExists($version->config['dir'].'/head_netral.png');
    }

    public function test_it_exports_the_selected_character_version_as_a_zip_download(): void
    {
        $user = User::factory()->create();
        $character = Character::create(['user_id' => $user->id, 'kind' => 'card', 'name' => 'Jacky', 'method' => 'rig', 'current_version' => 1]);
        $dir = 'cards/test-package';
        Storage::disk('local')->put($dir.'/body_diam.png', $this->pngBytes());
        Storage::disk('local')->put($dir.'/head_netral.png', $this->pngBytes());
        CharacterVersion::create([
            'character_id' => $character->id,
            'number' => 1,
            'config' => [
                'type' => 'card', 'dir' => $dir,
                'meta' => ['name' => 'Jacky', 'body' => ['canvas' => [24, 32], 'feet_y' => 32, 'center_x' => 12, 'poses' => ['diam']], 'head' => ['canvas' => [12, 12], 'paste_on_body' => [6, 2], 'expressions' => ['netral']]],
                'files' => ['body' => ['diam' => 'body_diam.png'], 'head' => ['netral' => 'head_netral.png'], 'mouth' => [], 'blink' => null],
            ],
            'note' => 'fixture',
        ]);

        $this->withHeaders($this->auth($user))->get('/api/builder/cards/'.$character->id.'/export-package')
            ->assertOk()->assertDownload('jacky-v1.zip');
    }
}
