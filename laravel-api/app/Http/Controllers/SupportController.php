<?php

namespace App\Http\Controllers;

use App\Services\SupportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class SupportController extends Controller
{
    public function __construct(private readonly SupportService $support) {}

    public function create(Request $request): JsonResponse
    {
        $input = $request->validate([
            'category' => ['required', Rule::in(['ACCOUNT', 'PAYMENT', 'ORDER', 'TECHNICAL', 'SAFETY', 'OTHER'])],
            'subject' => ['required', 'string', 'min:5', 'max:120'],
            'message' => ['required', 'string', 'min:20', 'max:2000'],
            'source' => ['required', Rule::in(['WEB', 'MOBILE'])],
        ]);

        return response()->json($this->support->create($this->userId($request), $input));
    }

    public function mine(Request $request): JsonResponse
    {
        return response()->json($this->support->mine($this->userId($request)));
    }

    private function userId(Request $request): string
    {
        return (string) $request->attributes->get('auth.user')->id;
    }
}
