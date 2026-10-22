<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\DisputeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class AdminDisputesController extends Controller
{
    public function __construct(private readonly DisputeService $disputes) {}

    public function index(Request $request): JsonResponse
    {
        $input = $request->validate([
            'status' => ['sometimes', Rule::in(['OPEN', 'WAITING_FOR_CLIENT', 'WAITING_FOR_PROVIDER', 'READY_FOR_REVIEW', 'UNDER_REVIEW', 'RESOLVED_CLIENT', 'RESOLVED_PROVIDER', 'CLOSED'])],
            'cursor' => ['sometimes', 'string'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->disputes->adminList(
            $input['status'] ?? null, $input['cursor'] ?? null, (int) ($input['limit'] ?? 20),
        ));
    }

    public function detail(string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->disputes->adminDetail($id));
    }

    public function evidence(string $id, string $evidenceId): Response
    {
        $this->requireUuid($id);
        $this->requireUuid($evidenceId);
        $evidence = $this->disputes->adminEvidence($id, $evidenceId);

        return app(DisputesController::class)->downloadEvidence($evidence);
    }

    public function requestResponse(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate(['requestedFrom' => ['required', Rule::in(['CLIENT', 'PROVIDER'])]]);

        return response()->json($this->disputes->requestResponse($this->user($request)->id, $id, $input['requestedFrom']));
    }

    public function ready(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->disputes->markReady($this->user($request)->id, $id));
    }

    public function review(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->disputes->beginReview($this->user($request)->id, $id));
    }

    public function resolve(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate([
            'status' => ['required', Rule::in(['RESOLVED_CLIENT', 'RESOLVED_PROVIDER', 'CLOSED'])],
            'resolutionNote' => ['required', 'string', 'min:3', 'max:191'],
        ]);

        return response()->json($this->disputes->resolve($this->user($request)->id, $id,
            $input['status'], $input['resolutionNote']));
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid dispute id');
    }
}
