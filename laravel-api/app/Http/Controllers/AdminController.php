<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AdminService;
use App\Services\VerificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

class AdminController extends Controller
{
    public function __construct(
        private readonly AdminService $admin,
        private readonly VerificationService $verifications,
    ) {}

    public function dashboard(): JsonResponse
    {
        return response()->json($this->admin->dashboard());
    }

    public function verifications(Request $request): JsonResponse
    {
        $input = $this->page($request);

        return response()->json($this->verifications->listPending(
            $this->user($request)->id, $this->isAdmin($request), $input['cursor'] ?? null, (int) ($input['limit'] ?? 20),
        ));
    }

    public function services(Request $request): JsonResponse
    {
        $input = $this->page($request);

        return response()->json($this->admin->pendingServices($input['cursor'] ?? null, (int) ($input['limit'] ?? 20)));
    }

    public function document(Request $request, string $id): Response|RedirectResponse
    {
        $this->requireUuid($id, 'verification');
        $path = $this->verifications->documentPath($id, $this->user($request)->id, $this->isAdmin($request));
        abort_unless(preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/', $path) === 1, 500);
        $diskName = (string) config('campusgig.private_storage_disk', 'campusgig_private');
        $disk = Storage::disk($diskName);
        $key = 'student-ids/'.$path;
        abort_unless($disk->exists($key), 404, 'Verification document not found');
        if (config("filesystems.disks.{$diskName}.driver") === 's3') {
            return redirect()->away($disk->temporaryUrl($key, now()->addMinutes(5)));
        }

        return $disk->download($key, 'Student ID', ['Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function approveVerification(Request $request, string $id): JsonResponse
    {
        return $this->reviewVerification($request, $id, true);
    }

    public function rejectVerification(Request $request, string $id): JsonResponse
    {
        return $this->reviewVerification($request, $id, false);
    }

    public function approveService(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id, 'service');

        return response()->json($this->admin->reviewService($id, $this->user($request)->id, true, null));
    }

    public function rejectService(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id, 'service');
        $input = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);

        return response()->json($this->admin->reviewService($id, $this->user($request)->id, false, $input['reason']));
    }

    public function schoolAdmins(Request $request): JsonResponse
    {
        $input = $this->page($request);

        return response()->json($this->admin->schoolAdmins($input['cursor'] ?? null, (int) ($input['limit'] ?? 20)));
    }

    public function assignSchoolAdmin(Request $request): JsonResponse
    {
        $input = $request->validate(['email' => ['required', 'email', 'max:254'], 'schoolId' => ['required', 'uuid']]);

        return response()->json($this->admin->assignSchoolAdmin($input['email'], $input['schoolId']));
    }

    public function removeSchoolAdmin(string $userId): JsonResponse
    {
        $this->requireUuid($userId, 'user');

        return response()->json($this->admin->removeSchoolAdmin($userId));
    }

    private function reviewVerification(Request $request, string $id, bool $approved): JsonResponse
    {
        $this->requireUuid($id, 'verification');
        $reason = $approved ? null : $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']])['reason'];

        return response()->json($this->verifications->review(
            $id, $this->user($request)->id, $approved, $reason, $this->isAdmin($request),
        ));
    }

    private function page(Request $request): array
    {
        return $request->validate(['cursor' => ['sometimes', 'string'], 'limit' => ['sometimes', 'integer', 'min:1', 'max:100']]);
    }

    private function isAdmin(Request $request): bool
    {
        return $this->user($request)->roleAssignments->contains('role', 'ADMIN');
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }

    private function requireUuid(string $id, string $resource): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, "Invalid {$resource} id");
    }
}
