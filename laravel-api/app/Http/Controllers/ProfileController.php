<?php

namespace App\Http\Controllers;

use App\Services\ProfileService;
use App\Services\VerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class ProfileController extends Controller
{
    public function __construct(
        private readonly ProfileService $profiles,
        private readonly VerificationService $verifications,
    ) {}

    public function uploadAvatar(Request $request): JsonResponse
    {
        $request->validate(['avatar' => ['required', 'file', 'max:5120', 'mimetypes:image/jpeg,image/png']]);

        return response()->json($this->profiles->updateAvatar($this->userId($request), $request->file('avatar')));
    }

    public function avatar(string $userId): Response|RedirectResponse
    {
        $this->requireUuid($userId, 'user');

        return $this->deliver('avatars', $this->profiles->avatarPath($userId), true);
    }

    public function student(Request $request): JsonResponse
    {
        return response()->json($this->profiles->student($this->userId($request)));
    }

    public function updateStudent(Request $request): JsonResponse
    {
        $input = $request->validate([
            'schoolId' => ['required', 'uuid'], 'program' => ['required', 'string', 'max:120'],
            'yearLevel' => ['required', 'integer', 'min:1', 'max:6'],
            'bio' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        return response()->json($this->profiles->updateStudent($this->userId($request), $input));
    }

    public function verification(Request $request): JsonResponse
    {
        return response()->json($this->verifications->latest($this->userId($request)));
    }

    public function submitVerification(Request $request): JsonResponse
    {
        $request->validate(['studentId' => ['required', 'file', 'max:5120', 'mimetypes:image/jpeg,image/png,application/pdf']]);

        return response()->json($this->verifications->submit($this->userId($request), $request->file('studentId')));
    }

    private function deliver(string $namespace, string $path, bool $inline): Response|RedirectResponse
    {
        abort_unless(preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/', $path) === 1, 500);
        $diskName = (string) config('campusgig.private_storage_disk', 'campusgig_private');
        $disk = Storage::disk($diskName);
        $key = "{$namespace}/{$path}";
        abort_unless($disk->exists($key), 404, 'Profile picture not found');
        if (config("filesystems.disks.{$diskName}.driver") === 's3') {
            return redirect()->away($disk->temporaryUrl($key, now()->addMinutes(5)));
        }
        $headers = ['Cache-Control' => 'private, max-age=300', 'X-Content-Type-Options' => 'nosniff'];

        return $inline ? response()->file($disk->path($key), $headers) : $disk->download($key, basename($path), $headers);
    }

    private function requireUuid(string $id, string $resource): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, "Invalid {$resource} id");
    }

    private function userId(Request $request): string
    {
        return (string) $request->attributes->get('auth.user')->id;
    }
}
