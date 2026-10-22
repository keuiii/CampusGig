<?php

namespace App\Http\Controllers;

use App\Services\Payments\RefundService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class AdminRefundsController extends Controller
{
    public function __construct(private readonly RefundService $refunds) {}

    public function index(Request $request): JsonResponse
    {
        $input = $request->validate([
            'status' => ['sometimes', Rule::in(['REQUESTED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RECONCILIATION_REQUIRED'])],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->refunds->adminList($input['status'] ?? null, (int) ($input['limit'] ?? 25)));
    }

    public function staleRevisions(): JsonResponse
    {
        return response()->json($this->refunds->staleRevisionList());
    }

    public function fromDispute(Request $request, string $disputeId): JsonResponse
    {
        $this->requireUuid($disputeId);

        return response()->json($this->refunds->requestFromDispute($this->userId($request), $disputeId));
    }

    public function staleRevision(Request $request, string $revisionPurchaseId): JsonResponse
    {
        $this->requireUuid($revisionPurchaseId);

        return response()->json($this->refunds->remediateStaleRevision($this->userId($request), $revisionPurchaseId));
    }

    public function exception(Request $request): JsonResponse
    {
        $input = $request->validate([
            'sourceType' => ['required', Rule::in(['ORIGINAL_ORDER', 'PAID_EXTRA_REVISION'])],
            'sourceId' => ['required', 'uuid'],
            'policyNote' => ['required', 'string', 'min:20', 'max:500'],
        ]);

        return response()->json($this->refunds->requestAdminException(
            $this->userId($request), $input['sourceType'], $input['sourceId'], $input['policyNote'],
        ));
    }

    public function detail(string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->refunds->detail($id));
    }

    public function reconcile(string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->refunds->reconcile($id));
    }

    private function requireUuid(string $id): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid refund id');
    }

    private function userId(Request $request): string
    {
        return (string) $request->attributes->get('auth.user')->id;
    }
}
