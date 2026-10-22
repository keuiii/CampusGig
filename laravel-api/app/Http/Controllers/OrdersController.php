<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class OrdersController extends Controller
{
    public function __construct(private readonly OrderService $orders) {}

    public function index(Request $request): JsonResponse
    {
        $input = $request->validate([
            'scope' => ['sometimes', Rule::in(['client', 'provider'])],
            'view' => ['sometimes', Rule::in(['active', 'archived'])],
            'cursor' => ['sometimes', 'string'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:50'],
        ]);

        return response()->json($this->orders->list(
            $this->user($request)->id,
            $input['scope'] ?? 'client',
            $input['view'] ?? 'active',
            $input['cursor'] ?? null,
            (int) ($input['limit'] ?? 20),
        ));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->orders->find($this->user($request)->id, $id));
    }

    public function create(Request $request): JsonResponse
    {
        $input = $request->validate([
            'clientRequestId' => ['sometimes', 'uuid'],
            'serviceId' => ['required', 'uuid'],
            'servicePackageId' => ['sometimes', 'uuid'],
            'deliveryOption' => ['sometimes', Rule::in(['NORMAL', 'RUSH_24_HOURS', 'RUSH_12_HOURS', 'RUSH_6_HOURS', 'RUSH_3_HOURS'])],
            'requirements' => ['required', 'string', 'min:10', 'max:3000'],
            'requestedDeliveryDate' => ['sometimes', 'string', 'regex:/^\d{4}-\d{2}-\d{2}$/'],
        ]);

        return response()->json($this->orders->create($this->user($request)->id, $input), 201);
    }

    public function accept(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->orders->accept($this->user($request)->id, $id));
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);

        return response()->json($this->orders->reject($this->user($request)->id, $id, $input['reason']));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);

        return response()->json($this->orders->cancel($this->user($request)->id, $id, $input['reason']));
    }

    public function start(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->orders->start($this->user($request)->id, $id));
    }

    public function deliver(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate([
            'note' => ['required', 'string', 'min:3', 'max:1000'],
            'clientRequestId' => ['sometimes', 'uuid'],
            'files' => ['required', 'array', 'min:1', 'max:5'],
            'files.*' => ['required', 'file', 'max:15360', 'mimetypes:image/jpeg,image/png,image/webp,application/pdf,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ]);

        return response()->json($this->orders->deliver(
            $this->user($request)->id,
            $id,
            $input['note'],
            $request->file('files', []),
            $input['clientRequestId'] ?? null,
        ));
    }

    public function file(Request $request, string $id, string $fileId): Response
    {
        $this->requireUuid($id);
        $this->requireUuid($fileId);
        $file = $this->orders->getFile($this->user($request)->id, $id, $fileId);
        abort_unless(preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/', $file->storagePath) === 1, 500);
        $disk = Storage::disk((string) config('campusgig.private_storage_disk', 'campusgig_private'));
        $key = 'order-files/'.$file->storagePath;
        abort_unless($disk->exists($key), 404, 'Order file not found');

        return $disk->download($key, $file->originalName, [
            'Content-Type' => $file->mimeType,
            'Cache-Control' => 'private, no-store',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function revision(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate(['instructions' => ['required', 'string', 'min:10', 'max:2000']]);

        return response()->json($this->orders->requestRevision($this->user($request)->id, $id, $input['instructions']));
    }

    public function correctionClaim(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate(['instructions' => ['required', 'string', 'min:10', 'max:2000']]);

        return response()->json($this->orders->requestProviderCorrection(
            $this->user($request)->id,
            $id,
            $input['instructions'],
        ));
    }

    public function correctionDecision(Request $request, string $id, string $revisionId): JsonResponse
    {
        $this->requireUuid($id);
        $this->requireUuid($revisionId);
        $input = $request->validate(['accepted' => ['required', 'boolean']]);

        return response()->json($this->orders->decideProviderCorrection(
            $this->user($request)->id,
            $id,
            $revisionId,
            $input['accepted'],
        ));
    }

    public function complete(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->orders->complete($this->user($request)->id, $id));
    }

    public function review(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate([
            'overallRating' => ['required', 'integer', 'min:1', 'max:5'],
            'qualityRating' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'communicationRating' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'timelinessRating' => ['sometimes', 'integer', 'min:1', 'max:5'],
            'comment' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);

        return response()->json($this->orders->review($this->user($request)->id, $id, $input));
    }

    public function visibility(Request $request, string $id, string $action): JsonResponse
    {
        $this->requireUuid($id);
        abort_unless(in_array($action, ['archive', 'restore', 'remove'], true), 404);

        return response()->json($this->orders->updateVisibility($this->user($request)->id, $id, $action));
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid order id');
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }
}
