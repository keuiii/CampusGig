<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\ProviderManagementService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

class ProviderController extends Controller
{
    public function __construct(private readonly ProviderManagementService $providers) {}

    public function dashboard(Request $request): JsonResponse
    {
        return response()->json($this->providers->dashboard($this->user($request)->id));
    }

    public function profile(Request $request): JsonResponse
    {
        return response()->json($this->providers->profile($this->user($request)->id));
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $input = $request->validate([
            'headline' => ['required', 'string', 'min:3', 'max:100'],
            'bio' => ['required', 'string', 'min:20', 'max:1000'],
            'skills' => ['required', 'array', 'min:1', 'max:15'],
            'skills.*' => ['required', 'string'],
            'isAvailable' => ['sometimes', 'boolean'],
            'maxActiveOrders' => ['sometimes', 'integer', 'min:1', 'max:20'],
            'maxPendingOrders' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'instagramUrl' => ['sometimes', 'nullable', 'url:https', 'max:300'],
            'linkedinUrl' => ['sometimes', 'nullable', 'url:https', 'max:300'],
            'xUrl' => ['sometimes', 'nullable', 'url:https', 'max:300'],
            'portfolioUrl' => ['sometimes', 'nullable', 'url:https', 'max:300'],
        ]);

        return response()->json($this->providers->updateProfile($this->user($request)->id, $input));
    }

    public function updateAvailability(Request $request): JsonResponse
    {
        $input = $request->validate(['isAvailable' => ['required', 'boolean']]);

        return response()->json($this->providers->updateAvailability($this->user($request)->id, $input['isAvailable']));
    }

    public function services(Request $request): JsonResponse
    {
        return response()->json($this->providers->services($this->user($request)->id));
    }

    public function createService(Request $request): JsonResponse
    {
        return response()->json(
            $this->providers->createService($this->user($request)->id, $this->serviceInput($request)),
            201,
        );
    }

    public function updateService(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->providers->updateService(
            $this->user($request)->id,
            $id,
            $this->serviceInput($request),
        ));
    }

    public function submitService(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->providers->submitService($this->user($request)->id, $id));
    }

    public function reviseService(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        return response()->json($this->providers->reviseService($this->user($request)->id, $id));
    }

    public function transitionService(Request $request, string $id, string $action): JsonResponse
    {
        $this->requireUuid($id);
        abort_unless(in_array($action, ['pause', 'resume', 'archive', 'restore'], true), 404);

        return response()->json($this->providers->transitionService($this->user($request)->id, $id, $action));
    }

    public function uploadMedia(Request $request, string $id): JsonResponse
    {
        $this->requireUuid($id);

        $cover = $request->file('cover');
        if ($cover !== null && ! ($cover instanceof UploadedFile)) {
            abort(422, 'The cover must be a valid file.');
        }

        $portfolioInput = $request->file('portfolio', []);
        $portfolioFiles = [];
        if ($portfolioInput instanceof UploadedFile) {
            $portfolioFiles = [$portfolioInput];
        } elseif (is_array($portfolioInput)) {
            $portfolioFiles = array_values(array_filter($portfolioInput, fn ($f) => $f instanceof UploadedFile));
        }

        if ($cover) {
            validator(['cover' => $cover], [
                'cover' => ['file', 'max:8192', 'mimetypes:image/jpeg,image/png,image/webp'],
            ])->validate();
        }

        if (count($portfolioFiles) > 5) {
            abort(422, 'The portfolio field must not have more than 5 items.');
        }

        foreach ($portfolioFiles as $item) {
            validator(['portfolio' => $item], [
                'portfolio' => ['file', 'max:8192', 'mimetypes:image/jpeg,image/png,image/webp,application/pdf'],
            ])->validate();
        }

        return response()->json($this->providers->uploadServiceMedia(
            $this->user($request)->id,
            $id,
            $cover,
            $portfolioFiles,
        ));
    }

    public function ownedMedia(Request $request, string $id, string $mediaId): Response
    {
        $this->requireUuid($id);
        $this->requireUuid($mediaId, 'media');
        $media = $this->providers->ownedMedia($this->user($request)->id, $id, $mediaId);

        return $this->deliverMedia($media);
    }

    public function removeMedia(Request $request, string $id, string $mediaId): JsonResponse
    {
        $this->requireUuid($id);
        $this->requireUuid($mediaId, 'media');

        return response()->json($this->providers->removeServiceMedia($this->user($request)->id, $id, $mediaId));
    }

    private function serviceInput(Request $request): array
    {
        return $request->validate([
            'categoryId' => ['required', 'string', 'min:2', 'max:80'],
            'title' => ['required', 'string', 'min:10', 'max:120'],
            'description' => ['required', 'string', 'min:50', 'max:3000'],
            'deliveryMethod' => ['required', Rule::in(['ONLINE', 'IN_PERSON', 'HYBRID'])],
            'campusLocation' => ['sometimes', 'nullable', 'string', 'max:160'],
            'pricingModel' => ['sometimes', Rule::in(['LEGACY_PACKAGES', 'SINGLE_PRICE_V2'])],
            'basePriceCentavos' => ['sometimes', 'integer', 'min:100', 'max:10000000'],
            'normalDeliveryMinutes' => ['sometimes', 'integer', 'min:60', 'max:129600'],
            'includedRevisionLimit' => ['sometimes', 'integer', 'min:0', 'max:20'],
            'acceptsRushOrders' => ['sometimes', 'boolean'],
            'fastestRushTier' => ['sometimes', 'nullable', Rule::in(['HOURS_24', 'HOURS_12', 'HOURS_6', 'HOURS_3'])],
            'packages' => ['sometimes', 'array', 'min:1', 'max:3'],
            'packages.*.tier' => ['required', Rule::in(['BASIC', 'STANDARD', 'PREMIUM'])],
            'packages.*.name' => ['required', 'string', 'min:2', 'max:80'],
            'packages.*.description' => ['required', 'string', 'min:10', 'max:500'],
            'packages.*.priceCentavos' => ['required', 'integer', 'min:100', 'max:10000000'],
            'packages.*.deliveryDays' => ['required', 'integer', 'min:1', 'max:90'],
            'packages.*.revisionLimit' => ['required', 'integer', 'min:0', 'max:20'],
        ]);
    }

    private function deliverMedia(object $media): Response
    {
        abort_unless(preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/', $media->storagePath) === 1, 500);
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

    private function requireUuid(string $id, string $resource = 'service'): void
    {
        abort_unless(preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id) === 1, 400, "Invalid {$resource} id");
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->attributes->get('auth.user');

        return $user;
    }
}
