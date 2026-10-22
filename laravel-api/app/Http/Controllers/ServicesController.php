<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\MarketplacePricingService;
use App\Services\MarketplaceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class ServicesController extends Controller
{
    public function __construct(
        private readonly MarketplacePricingService $pricing,
        private readonly MarketplaceService $marketplace,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return response()->json($this->marketplace->list($this->validatedFilters($request)))
            ->header('Cache-Control', 'no-store');
    }

    public function savedIds(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return response()->json($this->marketplace->savedIds($user->id));
    }

    public function saved(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return response()->json($this->marketplace->list($this->validatedFilters($request), $user->id))
            ->header('Cache-Control', 'no-store');
    }

    public function save(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return response()->json($this->marketplace->save($user->id, $id));
    }

    public function unsave(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return response()->json($this->marketplace->unsave($user->id, $id));
    }

    public function show(string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->marketplace->find($id));
    }

    public function media(string $id, string $mediaId): Response
    {
        $this->requireUuid($id);
        $this->requireUuid($mediaId, 'media');
        $media = $this->marketplace->publicMedia($id, $mediaId);
        $diskName = (string) config('campusgig.private_storage_disk', 'campusgig_private');
        $disk = Storage::disk($diskName);
        $key = "service-media/{$media->storagePath}";
        abort_unless($disk->exists($key), 404, 'Service media file not found');

        if (config("filesystems.disks.{$diskName}.driver") === 's3') {
            return redirect()->away($disk->temporaryUrl($key, now()->addMinutes(5), [
                'ResponseContentType' => $media->mimeType,
                'ResponseContentDisposition' => 'inline',
            ]));
        }

        return response()->file($disk->path($key), [
            'Content-Type' => $media->mimeType,
            'Content-Disposition' => 'inline',
            'Cache-Control' => 'private, max-age=300',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    public function quote(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);
        $input = $request->validate(['deliveryOption' => ['required', Rule::in(['NORMAL', 'RUSH_24_HOURS', 'RUSH_12_HOURS', 'RUSH_6_HOURS', 'RUSH_3_HOURS'])]]);
        $service = DB::table('Service as service')
            ->join('ProviderProfile as profile', 'profile.userId', '=', 'service.providerId')
            ->join('StudentProfile as student', 'student.userId', '=', 'service.providerId')
            ->join('School as school', 'school.id', '=', 'student.schoolId')
            ->where('service.id', $id)->where('service.status', 'PUBLISHED')->whereNull('service.deletedAt')
            ->where('service.pricingModel', 'SINGLE_PRICE_V2')->whereNotNull('service.basePriceCentavos')
            ->whereNotNull('service.normalDeliveryMinutes')->whereNotNull('service.includedRevisionLimit')
            ->where('profile.isAvailable', true)->where('school.status', 'ACTIVE')
            ->select(['service.providerId', 'service.basePriceCentavos', 'service.normalDeliveryMinutes', 'service.includedRevisionLimit', 'service.acceptsRushOrders', 'service.fastestRushTier', 'profile.maxPendingOrders'])
            ->first();
        if (! $service) {
            abort(404, 'Service is no longer available');
        }
        /** @var User $user */
        $user = $request->attributes->get('auth.user');
        if ($service->providerId === $user->id) {
            abort(400, 'You cannot order your own service');
        }
        $pending = DB::table('Order')->where('providerId', $service->providerId)->where('status', 'REQUESTED')->count();
        if ($pending >= ($service->maxPendingOrders ?? 50)) {
            abort(409, "This provider's request queue is currently full. Please try again later.");
        }

        $terms = [
            'basePriceCentavos' => (int) $service->basePriceCentavos,
            'normalDeliveryMinutes' => (int) $service->normalDeliveryMinutes,
            'includedRevisionLimit' => (int) $service->includedRevisionLimit,
            'acceptsRushOrders' => (bool) $service->acceptsRushOrders,
            'fastestRushTier' => $service->fastestRushTier,
        ];

        return response()->json(['data' => [...$this->pricing->quote($terms, $input['deliveryOption']), 'eligibleDeliveryOptions' => $this->pricing->eligibleDeliveryOptions($terms)]]);
    }

    private function validatedFilters(Request $request): array
    {
        return $request->validate([
            'query' => ['sometimes', 'string', 'max:120'],
            'category' => ['sometimes', 'string', 'max:100'],
            'schoolId' => ['sometimes', 'uuid'],
            'budgetRange' => ['sometimes', Rule::in(['any', 'under-500', '500-999', '1000-2499', '2500-4999', '5000-plus'])],
            'minimumRating' => ['sometimes', 'numeric', 'min:0', 'max:5'],
            'maximumDeliveryDays' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'sort' => ['sometimes', Rule::in(['recommended', 'newest', 'rating', 'price-low', 'delivery-fast'])],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
        ]);
    }

    private function requireUuid(string $id, string $resource = 'service'): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, "Invalid {$resource} id");
    }
}
