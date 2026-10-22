<?php

namespace App\Http\Controllers;

use App\Models\Category;
use App\Models\School;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MarketplaceReferenceController extends Controller
{
    public function categories(): JsonResponse
    {
        $serviceCount = DB::table('Service as service')
            ->join('ProviderProfile as providerProfile', 'providerProfile.userId', '=', 'service.providerId')
            ->join('StudentProfile as studentProfile', 'studentProfile.userId', '=', 'service.providerId')
            ->join('School as school', 'school.id', '=', 'studentProfile.schoolId')
            ->whereColumn('service.categoryId', 'Category.id')
            ->where('service.status', 'PUBLISHED')
            ->whereNull('service.deletedAt')
            ->where('providerProfile.isAvailable', true)
            ->where('school.status', 'ACTIVE')
            ->selectRaw('COUNT(*)');

        $data = Category::query()->where('isActive', true)->select('Category.*')
            ->selectSub($serviceCount, 'serviceCount')->orderBy('sortOrder')->get();

        return response()->json(['data' => $data])->header('Cache-Control', 'no-store');
    }

    public function schools(): JsonResponse
    {
        $data = School::query()->where('status', 'ACTIVE')->orderBy('name')->get(['id', 'name', 'shortName', 'city']);

        return response()->json(['data' => $data])->header('Cache-Control', 'no-store');
    }

    public function adminSchools(): JsonResponse
    {
        return response()->json(['data' => School::query()->orderBy('name')->get()]);
    }

    public function createSchool(Request $request): JsonResponse
    {
        $input = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:160'],
            'shortName' => ['required', 'string', 'min:2', 'max:30'],
            'emailDomain' => ['sometimes', 'nullable', 'string', 'max:120'],
            'address' => ['sometimes', 'nullable', 'string', 'max:240'],
        ]);
        $school = School::query()->create([
            'name' => trim($input['name']), 'shortName' => trim($input['shortName']),
            'emailDomain' => filled($input['emailDomain'] ?? null) ? strtolower(trim($input['emailDomain'])) : null,
            'address' => filled($input['address'] ?? null) ? trim($input['address']) : null,
            'city' => 'Lipa City', 'status' => 'PENDING',
        ]);

        return response()->json($school, 201);
    }

    public function updateSchoolStatus(Request $request, string $id): JsonResponse
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, 'Invalid school id');
        $input = $request->validate(['status' => ['required', Rule::in(['PENDING', 'ACTIVE', 'DISABLED'])]]);
        $school = School::query()->findOrFail($id);
        $school->forceFill(['status' => $input['status']])->save();

        return response()->json($school);
    }
}
