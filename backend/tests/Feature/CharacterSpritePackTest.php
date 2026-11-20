<?php

namespace Tests\Feature;

use App\Models\Character;
use App\Models\CharacterSpritePack;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CharacterSpritePackTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function auth(User $user): array
    {
        $this->app['auth']->forgetGuards();

        return ['Authorization' => 'Bearer '.$user->createToken('sprite-pack-test')->plainTextToken, 'Accept' => 'application/json'];
    }

    private function png(int $width = 1024, int $height = 1024, bool $mark = false): UploadedFile
    {
        $image = imagecreatetruecolor($width, $height);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
        if ($mark) {
            imagesetpixel($image, 20, 20, imagecolorallocatealpha($image, 230, 30, 40, 0));
        }
        $path = tempnam(sys_get_temp_dir(), 'sprite-').'.png';
        imagepng($image, $path);
        imagedestroy($image);

        return new UploadedFile($path, 'sprite.png', 'image/png', null, true);
    }

    private function character(User $user): Character
    {
        return Character::create(['user_id' => $user->id, 'kind' => 'builder', 'name' => 'Uki', 'method' => 'rig']);
    }

    public function test_it_imports_a_transparent_1024_grid_and_builds_a_default_animation_manifest(): void
    {
        $user = User::factory()->create();
        $character = $this->character($user);

        $response = $this->withHeaders($this->auth($user))->post('/api/builder/characters/'.$character->id.'/sprite-packs', [
            'file' => $this->png(),
            'columns' => 1,
            'rows' => 1,
            'facing' => 'front',
            'animation_name' => 'idle',
            'fps' => 8,
            'loop' => true,
        ]);

        $response->assertCreated()->assertJsonPath('data.frame_width', 1024)->assertJsonPath('data.frame_count', 1)
            ->assertJsonPath('data.manifest.animations.idle.fps', 8)
            ->assertJsonPath('data.manifest.outfit.type', 'base');
        $this->assertDatabaseHas('character_sprite_packs', ['character_id' => $character->id, 'status' => 'pending_review']);
        Storage::disk('local')->assertExists(CharacterSpritePack::firstOrFail()->path);
    }

    public function test_it_rejects_an_atlas_whose_grid_does_not_match_1024_pixel_cells(): void
    {
        $user = User::factory()->create();
        $character = $this->character($user);

        $this->withHeaders($this->auth($user))->post('/api/builder/characters/'.$character->id.'/sprite-packs', [
            'file' => $this->png(512, 512),
            'columns' => 1,
            'rows' => 1,
            'facing' => 'front',
        ])->assertUnprocessable();
    }

    public function test_outfit_variant_requires_a_base_pack_and_matching_frame_ids(): void
    {
        $user = User::factory()->create();
        $character = $this->character($user);
        $headers = $this->auth($user);

        $this->withHeaders($headers)->post('/api/builder/characters/'.$character->id.'/sprite-packs', [
            'file' => $this->png(),
            'columns' => 1,
            'rows' => 1,
            'facing' => 'front',
            'animation_name' => 'idle',
        ])->assertCreated();

        $this->withHeaders($headers)->post('/api/builder/characters/'.$character->id.'/sprite-packs', [
            'file' => $this->png(1024, 1024, true),
            'columns' => 1,
            'rows' => 1,
            'facing' => 'front',
            'animation_name' => 'walk',
            'outfit_type' => 'outfit_variant',
            'outfit_id' => 'hoodie',
            'outfit_name' => 'Hoodie',
        ])->assertUnprocessable()->assertJsonPath('message', 'Outfit harus memiliki animation ID, urutan frame, facing, dan pivot yang sama dengan karakter dasar.');

        $this->assertDatabaseCount('character_sprite_packs', 1);
    }
}
