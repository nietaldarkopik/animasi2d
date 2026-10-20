<?php

namespace Tests\Feature;

use App\Models\AiJob;
use App\Models\ExportJob;
use App\Models\Project;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class OperationsTest extends TestCase
{
    use RefreshDatabase;

    public function test_prune_removes_old_exports_with_their_files_and_old_ai_jobs_only(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $project = Project::create(['user_id' => $user->id, 'name' => 'P', 'document' => Project::blankDocument()]);
        $make = function (string $tag, int $ageDays) use ($project, $user) {
            Storage::disk('local')->put("x/$tag.src.webm", 'src');
            Storage::disk('local')->put("x/$tag.mp4", 'out');
            $e = ExportJob::create(['project_id' => $project->id, 'user_id' => $user->id, 'format' => 'mp4', 'width' => 64, 'height' => 64, 'fps' => 10, 'status' => 'done', 'source_path' => "x/$tag.src.webm", 'output_path' => "x/$tag.mp4"]);
            $e->forceFill(['created_at' => now()->subDays($ageDays)])->save();

            return $e;
        };
        $old = $make('old', 10);
        $fresh = $make('fresh', 1);
        $oldAi = AiJob::create(['project_id' => $project->id, 'user_id' => $user->id, 'type' => 'prompt_to_motion', 'status' => 'done', 'input' => []]);
        $oldAi->forceFill(['created_at' => now()->subDays(40)])->save();
        $newAi = AiJob::create(['project_id' => $project->id, 'user_id' => $user->id, 'type' => 'prompt_to_motion', 'status' => 'done', 'input' => []]);

        $this->artisan('studio:prune')->expectsOutputToContain('Removed 1 export(s) and 1 AI job(s).')->assertSuccessful();

        $this->assertNull(ExportJob::find($old->id));
        $this->assertFalse(Storage::disk('local')->exists('x/old.mp4'));
        $this->assertFalse(Storage::disk('local')->exists('x/old.src.webm'));
        $this->assertNotNull(ExportJob::find($fresh->id));
        $this->assertTrue(Storage::disk('local')->exists('x/fresh.mp4'));
        $this->assertNull(AiJob::find($oldAi->id));
        $this->assertNotNull(AiJob::find($newAi->id));
    }

    public function test_scheduler_has_the_housekeeping_jobs(): void
    {
        $commands = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())->map(fn ($e) => $e->command)->implode("\n");
        $this->assertStringContainsString('studio:prune', $commands);
        $this->assertStringContainsString('sanctum:prune-expired', $commands);
    }

    public function test_https_app_url_forces_https_links(): void
    {
        config(['app.url' => 'https://studio.example.com']);
        (new AppServiceProvider($this->app))->boot();
        $this->assertStringStartsWith('https://', URL::to('/api/anything'));
        URL::forceScheme('http'); // do not leak into other tests
    }

    public function test_tokens_expire_after_the_configured_time(): void
    {
        $this->assertSame(43200, config('sanctum.expiration'));
    }

    public function test_registration_can_be_disabled_for_private_instances(): void
    {
        $this->getJson('/api/auth/options')->assertOk()->assertJsonPath('registration', true);
        $user = ['name' => 'A', 'email' => 'a@x.test', 'password' => 'password123'];

        config(['app.registration_enabled' => false]);
        $this->getJson('/api/auth/options')->assertOk()->assertJsonPath('registration', false);
        $this->postJson('/api/auth/register', $user)->assertForbidden();
        $this->assertDatabaseMissing('users', ['email' => 'a@x.test']);

        // existing accounts can still sign in
        User::factory()->create(['email' => 'old@x.test', 'password' => 'password123']);
        $this->postJson('/api/auth/login', ['email' => 'old@x.test', 'password' => 'password123'])->assertOk();

        config(['app.registration_enabled' => true]);
        $this->postJson('/api/auth/register', $user)->assertCreated();
    }

    public function test_empty_env_values_fall_back_to_defaults(): void
    {
        // a blank "WORKER_DIR=" line in .env once pointed Python at C:\imagetool.py; blank must mean "unset"
        putenv('WORKER_DIR=');
        $_ENV['WORKER_DIR'] = $_SERVER['WORKER_DIR'] = '';
        $services = require base_path('config/services.php');
        putenv('WORKER_DIR');
        unset($_ENV['WORKER_DIR'], $_SERVER['WORKER_DIR']);

        $this->assertNotSame('', $services['python']['worker_dir']);
        $this->assertFileExists(rtrim($services['python']['worker_dir'], '/\\').DIRECTORY_SEPARATOR.'imagetool.py');
    }

    public function test_health_endpoint_is_public(): void
    {
        $this->get('/up')->assertOk();
    }
}
