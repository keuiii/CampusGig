<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\DisputeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class DisputesController extends Controller
{
    public function __construct(private readonly DisputeService $disputes) {}

    public function index(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);

        return response()->json($this->disputes->forOrder($this->user($request)->id, $orderId));
    }

    public function open(Request $request, string $orderId): JsonResponse
    {
        $this->requireUuid($orderId);
        $input = $request->validate([
            'reason' => ['required', Rule::in(['SERVICE_NOT_DELIVERED', 'QUALITY_ISSUE', 'REQUIREMENTS_MISMATCH', 'PAYMENT_ISSUE', 'CONDUCT', 'OTHER'])],
            'details' => ['required', 'string', 'min:10', 'max:191'],
            'files' => ['sometimes', 'array', 'max:5'],
            'files.*' => ['file', 'max:15360', 'mimetypes:image/jpeg,image/png,image/webp,application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ]);

        return response()->json($this->disputes->open($this->user($request)->id, $orderId,
            $input['reason'], $input['details'], $request->file('files', [])), 201);
    }

    public function respond(Request $request, string $orderId, string $disputeId): JsonResponse
    {
        $this->requireUuid($orderId);
        $this->requireUuid($disputeId);
        $input = $request->validate([
            'details' => ['required', 'string', 'min:10', 'max:191'],
            'files' => ['sometimes', 'array', 'max:5'],
            'files.*' => ['file', 'max:15360', 'mimetypes:image/jpeg,image/png,image/webp,application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ]);

        return response()->json($this->disputes->submitResponse($this->user($request)->id, $orderId,
            $disputeId, $input['details'], $request->file('files', [])));
    }

    public function evidence(Request $request, string $orderId, string $disputeId): JsonResponse
    {
        $this->requireUuid($orderId);
        $this->requireUuid($disputeId);
        $request->validate([
            'files' => ['required', 'array', 'min:1', 'max:5'],
            'files.*' => ['required', 'file', 'max:15360', 'mimetypes:image/jpeg,image/png,image/webp,application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ]);

        return response()->json($this->disputes->appendEvidence($this->user($request)->id, $orderId,
            $disputeId, $request->file('files', [])));
    }

    public function download(Request $request, string $orderId, string $disputeId, string $evidenceId): Response
    {
        $this->requireUuid($orderId);
        $this->requireUuid($disputeId);
        $this->requireUuid($evidenceId);
        $evidence = $this->disputes->evidence($this->user($request)->id, $orderId, $disputeId, $evidenceId);

        return $this->downloadEvidence($evidence);
    }

    public function downloadEvidence(object $evidence): Response
    {
        abort_unless(preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/', $evidence->storagePath) === 1, 500);
        $disk = Storage::disk((string) config('campusgig.private_storage_disk', 'campusgig_private'));
        $key = 'dispute-evidence/'.$evidence->storagePath;
        abort_unless($disk->exists($key), 404, 'Evidence file not found');

        return $disk->download($key, $evidence->originalName, [
            'Content-Type' => $evidence->mimeType, 'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid identifier');
    }
}
