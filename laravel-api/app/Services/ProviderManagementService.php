<?php

namespace App\Services;

use App\Services\Storage\PrivateMediaStorage;
use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ProviderManagementService
{
    public function __construct(private readonly PrivateMediaStorage $storage) {}

    public function dashboard(string $userId): array
    {
        $profile = DB::table('ProviderProfile')->where('userId', $userId)->first();
        $activeOrders = DB::table('Order')->where('providerId', $userId)
            ->whereIn('status', ['ACCEPTED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'])->count();
        $pendingRequests = DB::table('Order')->where('providerId', $userId)->where('status', 'REQUESTED')->count();
        $completedOrders = DB::table('Order')->where('providerId', $userId)->where('status', 'COMPLETED')->count();
        $review = DB::table('Review as review')->join('Order as order', 'order.id', '=', 'review.orderId')
            ->where('review.revieweeId', $userId)->where('order.status', 'COMPLETED')
            ->selectRaw('AVG(review.overallRating) AS averageRating, COUNT(*) AS reviewCount')->first();
        $services = DB::table('Service')->where('providerId', $userId)->whereNull('deletedAt');
        $serviceCount = (clone $services)->count();
        $publishedServiceCount = (clone $services)->where('status', 'PUBLISHED')->count();
        $verificationStatus = DB::table('StudentProfile')->where('userId', $userId)->value('verificationStatus');
        $hasCompleteIdentity = $profile
            && trim((string) $profile->headline) !== ''
            && trim((string) $profile->bio) !== ''
            && $this->decodeSkills($profile->skills) !== [];

        return [
            'activeOrders' => $activeOrders,
            'pendingRequests' => $pendingRequests,
            'completedOrders' => $completedOrders,
            'averageRating' => (float) ($review->averageRating ?? 0),
            'reviewCount' => (int) ($review->reviewCount ?? 0),
            'profileStrength' => ($hasCompleteIdentity ? 34 : 0) + ($serviceCount > 0 ? 33 : 0) + ($publishedServiceCount > 0 ? 33 : 0),
            'verified' => $verificationStatus === 'APPROVED',
            'maxActiveOrders' => (int) ($profile->maxActiveOrders ?? 5),
            'maxPendingOrders' => (int) ($profile->maxPendingOrders ?? 50),
            'acceptingOrders' => (bool) ($profile->isAvailable ?? false)
                && $pendingRequests < (int) ($profile->maxPendingOrders ?? 50),
        ];
    }

    public function profile(string $userId): array
    {
        $profile = DB::table('ProviderProfile')->where('userId', $userId)->first();

        return ['data' => $profile ? $this->profileResponse($profile) : null];
    }

    public function updateProfile(string $userId, array $input): array
    {
        $this->requireVerified($userId);
        $skills = array_values(array_unique(array_filter(
            array_map(fn (string $skill): string => trim($skill), $input['skills']),
            fn (string $skill): bool => $skill !== '',
        )));
        if ($skills === []) {
            throw $this->badRequest('Add at least one skill');
        }
        $existing = DB::table('ProviderProfile')->where('userId', $userId)->first();
        $now = now();
        $data = [
            'headline' => trim($input['headline']),
            'bio' => trim($input['bio']),
            'skills' => json_encode($skills, JSON_THROW_ON_ERROR),
            'isAvailable' => $input['isAvailable'] ?? true,
            'maxActiveOrders' => $input['maxActiveOrders'] ?? ($existing->maxActiveOrders ?? 5),
            'maxPendingOrders' => $input['maxPendingOrders'] ?? ($existing->maxPendingOrders ?? 50),
            'instagramUrl' => $this->nullableTrim($input['instagramUrl'] ?? null),
            'linkedinUrl' => $this->nullableTrim($input['linkedinUrl'] ?? null),
            'xUrl' => $this->nullableTrim($input['xUrl'] ?? null),
            'portfolioUrl' => $this->nullableTrim($input['portfolioUrl'] ?? null),
            'updatedAt' => $now,
        ];
        if ($existing) {
            DB::table('ProviderProfile')->where('userId', $userId)->update($data);
        } else {
            DB::table('ProviderProfile')->insert(['userId' => $userId, 'createdAt' => $now, ...$data]);
        }

        return $this->profile($userId);
    }

    public function updateAvailability(string $userId, bool $isAvailable): array
    {
        $this->requireVerified($userId);
        $updated = DB::table('ProviderProfile')->where('userId', $userId)->update([
            'isAvailable' => $isAvailable,
            'updatedAt' => now(),
        ]);
        if ($updated !== 1) {
            throw $this->badRequest('Complete your provider profile before changing availability');
        }

        return [
            ...$this->profile($userId),
            'message' => $isAvailable
                ? 'You are online and accepting new requests'
                : 'You are offline and your services are paused',
        ];
    }

    public function services(string $userId): array
    {
        $rows = DB::table('Service as service')
            ->join('Category as category', 'category.id', '=', 'service.categoryId')
            ->where('service.providerId', $userId)->whereNull('service.deletedAt')
            ->orderByDesc('service.updatedAt')
            ->get([
                'service.*', 'category.name as categoryName', 'category.icon as categoryIcon',
                'category.color as categoryColor', 'category.isActive as categoryIsActive', 'category.sortOrder as categorySortOrder',
            ]);

        return ['data' => $this->hydrateServices($rows)];
    }

    public function createService(string $userId, array $input): array
    {
        $this->requireVerified($userId);
        if (! DB::table('ProviderProfile')->where('userId', $userId)->exists()) {
            throw $this->badRequest('Complete your provider profile before creating a service');
        }
        $this->requireActiveCategory($input['categoryId']);
        $pricingModel = $input['pricingModel'] ?? 'LEGACY_PACKAGES';
        $this->validateServiceTerms($pricingModel, $input);
        $serviceId = (string) Str::uuid();
        $now = now();
        $slugBase = substr(Str::slug(trim($input['title'])), 0, 80) ?: 'service';

        DB::transaction(function () use ($userId, $input, $pricingModel, $serviceId, $slugBase, $now): void {
            DB::table('Service')->insert([
                'id' => $serviceId,
                'providerId' => $userId,
                'categoryId' => $input['categoryId'],
                'title' => trim($input['title']),
                'slug' => $slugBase.'-'.strtolower(Str::random(10)),
                'description' => trim($input['description']),
                'deliveryMethod' => $input['deliveryMethod'],
                'pricingModel' => $pricingModel,
                'basePriceCentavos' => $pricingModel === 'SINGLE_PRICE_V2' ? $input['basePriceCentavos'] : null,
                'normalDeliveryMinutes' => $pricingModel === 'SINGLE_PRICE_V2' ? $input['normalDeliveryMinutes'] : null,
                'includedRevisionLimit' => $pricingModel === 'SINGLE_PRICE_V2' ? $input['includedRevisionLimit'] : null,
                'acceptsRushOrders' => $pricingModel === 'SINGLE_PRICE_V2' ? ($input['acceptsRushOrders'] ?? false) : false,
                'fastestRushTier' => $pricingModel === 'SINGLE_PRICE_V2' && ($input['acceptsRushOrders'] ?? false)
                    ? $input['fastestRushTier'] : null,
                'campusLocation' => $this->nullableTrim($input['campusLocation'] ?? null),
                'status' => 'DRAFT',
                'createdAt' => $now,
                'updatedAt' => $now,
            ]);
            if ($pricingModel === 'LEGACY_PACKAGES') {
                $this->insertPackages($serviceId, $input['packages']);
            }
        });

        return ['data' => $this->ownedService($userId, $serviceId)];
    }

    public function updateService(string $userId, string $serviceId, array $input): array
    {
        $this->requireVerified($userId);
        $service = $this->serviceState($userId, $serviceId);
        if (isset($input['pricingModel']) && $input['pricingModel'] !== $service->pricingModel) {
            throw $this->conflict('A service pricing model cannot be converted after creation');
        }
        if (! in_array($service->status, ['DRAFT', 'REJECTED'], true)) {
            throw $this->conflict('Only draft or rejected services can be edited');
        }
        $this->requireActiveCategory($input['categoryId']);
        $this->validateServiceTerms($service->pricingModel, $input);

        DB::transaction(function () use ($userId, $serviceId, $service, $input): void {
            $updated = DB::table('Service')->where('id', $serviceId)->where('providerId', $userId)
                ->whereNull('deletedAt')->where('status', $service->status)->update([
                    'categoryId' => $input['categoryId'],
                    'title' => trim($input['title']),
                    'description' => trim($input['description']),
                    'deliveryMethod' => $input['deliveryMethod'],
                    'campusLocation' => $this->nullableTrim($input['campusLocation'] ?? null),
                    'rejectionReason' => null,
                    'basePriceCentavos' => $service->pricingModel === 'SINGLE_PRICE_V2' ? $input['basePriceCentavos'] : null,
                    'normalDeliveryMinutes' => $service->pricingModel === 'SINGLE_PRICE_V2' ? $input['normalDeliveryMinutes'] : null,
                    'includedRevisionLimit' => $service->pricingModel === 'SINGLE_PRICE_V2' ? $input['includedRevisionLimit'] : null,
                    'acceptsRushOrders' => $service->pricingModel === 'SINGLE_PRICE_V2' ? ($input['acceptsRushOrders'] ?? false) : false,
                    'fastestRushTier' => $service->pricingModel === 'SINGLE_PRICE_V2' && ($input['acceptsRushOrders'] ?? false)
                        ? $input['fastestRushTier'] : null,
                    'updatedAt' => now(),
                ]);
            if ($updated !== 1) {
                throw $this->conflict('The listing changed in another session. Refresh and try again.');
            }
            if ($service->pricingModel === 'LEGACY_PACKAGES') {
                DB::table('ServicePackage')->where('serviceId', $serviceId)->delete();
                $this->insertPackages($serviceId, $input['packages']);
            }
        });

        return ['data' => $this->ownedService($userId, $serviceId)];
    }

    public function submitService(string $userId, string $serviceId): array
    {
        $service = $this->serviceState($userId, $serviceId);
        if (! in_array($service->status, ['DRAFT', 'REJECTED'], true)) {
            throw $this->conflict('Only draft or rejected services can be submitted');
        }
        $this->validateStoredServiceTerms($service);
        $this->conditionalStatusUpdate($userId, $serviceId, $service->status, [
            'status' => 'PENDING_REVIEW', 'reviewedAt' => null, 'reviewedBy' => null, 'rejectionReason' => null,
        ]);

        return ['data' => $this->ownedService($userId, $serviceId)];
    }

    public function reviseService(string $userId, string $serviceId): array
    {
        $service = $this->serviceState($userId, $serviceId);
        if (! in_array($service->status, ['PUBLISHED', 'PAUSED'], true)) {
            throw $this->conflict('Only published or paused services can start a revision');
        }
        $this->conditionalStatusUpdate($userId, $serviceId, $service->status, [
            'status' => 'DRAFT', 'publishedAt' => null, 'reviewedAt' => null, 'reviewedBy' => null, 'rejectionReason' => null,
        ]);

        return [
            'data' => $this->ownedService($userId, $serviceId),
            'message' => 'Listing moved to a private draft. Edit and resubmit it for administrator review.',
        ];
    }

    public function transitionService(string $userId, string $serviceId, string $action): array
    {
        $transitions = [
            'pause' => [['PUBLISHED'], 'PAUSED', 'Listing paused and removed from the marketplace'],
            'resume' => [['PAUSED'], 'PUBLISHED', 'Listing is visible in the marketplace again'],
            'archive' => [['PUBLISHED', 'PAUSED'], 'ARCHIVED', 'Listing archived'],
            'restore' => [['ARCHIVED'], 'PAUSED', 'Listing restored in a paused state'],
        ];
        [$allowed, $next, $message] = $transitions[$action];
        $service = $this->serviceState($userId, $serviceId);
        if (! in_array($service->status, $allowed, true)) {
            $current = strtolower(str_replace('_', ' ', $service->status));
            throw $this->conflict("A {$current} listing cannot be moved to ".strtolower($next));
        }
        $this->conditionalStatusUpdate($userId, $serviceId, $service->status, ['status' => $next]);

        return ['data' => $this->ownedService($userId, $serviceId), 'message' => $message];
    }

    public function uploadServiceMedia(string $userId, string $serviceId, ?UploadedFile $cover, array $portfolio): array
    {
        if (! $cover && $portfolio === []) {
            throw $this->badRequest('Select a cover image or portfolio file');
        }
        $service = $this->serviceState($userId, $serviceId);
        if (! in_array($service->status, ['DRAFT', 'REJECTED'], true)) {
            throw $this->conflict('Media can only be changed on draft or rejected services');
        }
        $existing = DB::table('ServiceMedia')->where('serviceId', $serviceId)->get();
        $portfolioCount = $existing->where('kind', 'PORTFOLIO')->count();
        if ($portfolioCount + count($portfolio) > 5) {
            throw $this->badRequest('A service can have up to five portfolio files');
        }
        $stored = [];
        $oldCover = $existing->firstWhere('kind', 'COVER');

        try {
            if ($cover) {
                $stored[] = ['file' => $cover, 'kind' => 'COVER', 'key' => $this->storage->storeServiceMedia($cover), 'sortOrder' => 0];
            }
            foreach ($portfolio as $index => $file) {
                $stored[] = [
                    'file' => $file,
                    'kind' => 'PORTFOLIO',
                    'key' => $this->storage->storeServiceMedia($file),
                    'sortOrder' => $portfolioCount + $index,
                ];
            }

            $result = DB::transaction(function () use ($serviceId, $cover, $oldCover, $stored) {
                if ($cover && $oldCover) {
                    DB::table('ServiceMedia')->where('id', $oldCover->id)->delete();
                }
                foreach ($stored as $item) {
                    /** @var UploadedFile $file */
                    $file = $item['file'];
                    DB::table('ServiceMedia')->insert([
                        'id' => (string) Str::uuid(),
                        'serviceId' => $serviceId,
                        'kind' => $item['kind'],
                        'storagePath' => $item['key'],
                        'originalName' => $this->safeOriginalName($file),
                        'mimeType' => (string) $file->getMimeType(),
                        'sizeBytes' => (int) $file->getSize(),
                        'sortOrder' => $item['sortOrder'],
                        'createdAt' => now(),
                    ]);
                }

                return DB::table('ServiceMedia')->where('serviceId', $serviceId)
                    ->orderBy('kind')->orderBy('sortOrder')->get();
            });
        } catch (\Throwable $error) {
            foreach ($stored as $item) {
                $this->storage->deleteServiceMedia($item['key']);
            }
            throw $error;
        }

        if ($cover && $oldCover) {
            $this->storage->deleteServiceMedia($oldCover->storagePath);
        }

        return ['data' => $result->map(fn (object $item): array => $this->mediaResponse($item))->all()];
    }

    public function removeServiceMedia(string $userId, string $serviceId, string $mediaId): array
    {
        $media = $this->ownedMedia($userId, $serviceId, $mediaId, true);
        DB::table('ServiceMedia')->where('id', $mediaId)->delete();
        $this->storage->deleteServiceMedia($media->storagePath);

        return ['message' => 'Service media removed'];
    }

    public function ownedMedia(string $userId, string $serviceId, string $mediaId, bool $requireEditable = false): object
    {
        $media = DB::table('ServiceMedia as media')
            ->join('Service as service', 'service.id', '=', 'media.serviceId')
            ->where('media.id', $mediaId)->where('media.serviceId', $serviceId)
            ->where('service.providerId', $userId)->whereNull('service.deletedAt')
            ->select(['media.*', 'service.status as serviceStatus'])->first();
        if (! $media) {
            throw $this->notFound('Service media not found');
        }
        if ($requireEditable && ! in_array($media->serviceStatus, ['DRAFT', 'REJECTED'], true)) {
            throw $this->conflict('Media can only be changed on draft or rejected services');
        }

        return $media;
    }

    private function hydrateServices($rows): array
    {
        if ($rows->isEmpty()) {
            return [];
        }
        $ids = $rows->pluck('id')->all();
        $packages = DB::table('ServicePackage')->whereIn('serviceId', $ids)->orderBy('priceCentavos')->get()->groupBy('serviceId');
        $media = DB::table('ServiceMedia')->whereIn('serviceId', $ids)->orderBy('kind')->orderBy('sortOrder')->get()->groupBy('serviceId');

        return $rows->map(function (object $row) use ($packages, $media): array {
            $service = (array) $row;
            foreach (['categoryName', 'categoryIcon', 'categoryColor', 'categoryIsActive', 'categorySortOrder'] as $field) {
                unset($service[$field]);
            }
            foreach (['publishedAt', 'reviewedAt', 'createdAt', 'updatedAt', 'deletedAt'] as $field) {
                if (! empty($service[$field])) {
                    $service[$field] = CarbonImmutable::parse($service[$field])->toISOString();
                }
            }
            $service['acceptsRushOrders'] = (bool) $service['acceptsRushOrders'];
            $service['category'] = [
                'id' => $row->categoryId,
                'name' => $row->categoryName,
                'icon' => $row->categoryIcon,
                'color' => $row->categoryColor,
                'isActive' => (bool) $row->categoryIsActive,
                'sortOrder' => (int) $row->categorySortOrder,
            ];
            $service['packages'] = collect($packages->get($row->id, []))->map(function (object $package): array {
                $item = (array) $package;
                $item['priceCentavos'] = (int) $item['priceCentavos'];
                $item['deliveryDays'] = (int) $item['deliveryDays'];
                $item['revisionLimit'] = (int) $item['revisionLimit'];
                $item['isActive'] = (bool) $item['isActive'];

                return $item;
            })->all();
            $service['media'] = collect($media->get($row->id, []))->map(function (object $item): array {
                $response = (array) $item;
                if (! empty($response['createdAt'])) {
                    $response['createdAt'] = CarbonImmutable::parse($response['createdAt'])->toISOString();
                }

                return $response;
            })->all();

            return $service;
        })->all();
    }

    private function ownedService(string $userId, string $serviceId): array
    {
        $response = $this->services($userId)['data'];
        foreach ($response as $service) {
            if ($service['id'] === $serviceId) {
                return $service;
            }
        }

        throw $this->notFound('Service not found');
    }

    private function serviceState(string $userId, string $serviceId): object
    {
        $service = DB::table('Service')->where('id', $serviceId)->where('providerId', $userId)
            ->whereNull('deletedAt')->first();
        if (! $service) {
            throw $this->notFound('Service not found');
        }

        return $service;
    }

    private function requireActiveCategory(string $categoryId): void
    {
        if (! DB::table('Category')->where('id', $categoryId)->where('isActive', true)->exists()) {
            throw $this->badRequest('Select an active service category');
        }
    }

    private function validateServiceTerms(string $pricingModel, array $input): void
    {
        if ($pricingModel === 'LEGACY_PACKAGES') {
            if (empty($input['packages'])) {
                throw $this->badRequest('Add at least one package');
            }
            foreach (['basePriceCentavos', 'normalDeliveryMinutes', 'includedRevisionLimit', 'acceptsRushOrders', 'fastestRushTier'] as $field) {
                if (array_key_exists($field, $input)) {
                    throw $this->badRequest('Legacy package services cannot include single-price terms');
                }
            }
            $tiers = array_column($input['packages'], 'tier');
            if (count(array_unique($tiers)) !== count($tiers)) {
                throw $this->badRequest('Each package tier can only be used once');
            }

            return;
        }

        if (! empty($input['packages'])) {
            throw $this->badRequest('Single-price services cannot include legacy packages');
        }
        foreach (['basePriceCentavos', 'normalDeliveryMinutes', 'includedRevisionLimit'] as $field) {
            if (! array_key_exists($field, $input)) {
                throw $this->badRequest('Single-price services require price, delivery time, and included revisions');
            }
        }
        $this->validateRushSettings(
            (int) $input['normalDeliveryMinutes'],
            (bool) ($input['acceptsRushOrders'] ?? false),
            $input['fastestRushTier'] ?? null,
        );
    }

    private function validateStoredServiceTerms(object $service): void
    {
        $packageCount = DB::table('ServicePackage')->where('serviceId', $service->id)->where('isActive', true)->count();
        if ($service->pricingModel === 'LEGACY_PACKAGES') {
            if ($packageCount === 0) {
                throw $this->badRequest('Add at least one active package');
            }

            return;
        }
        if ($packageCount !== 0 || $service->basePriceCentavos === null || $service->normalDeliveryMinutes === null || $service->includedRevisionLimit === null) {
            throw $this->badRequest('Complete the single-price terms before submitting this service');
        }
        $this->validateRushSettings(
            (int) $service->normalDeliveryMinutes,
            (bool) $service->acceptsRushOrders,
            $service->fastestRushTier,
        );
    }

    private function validateRushSettings(int $normalDeliveryMinutes, bool $acceptsRushOrders, ?string $fastestRushTier): void
    {
        if (! $acceptsRushOrders && $fastestRushTier !== null) {
            throw $this->badRequest('A fastest rush turnaround is only valid when rush orders are enabled');
        }
        if ($acceptsRushOrders && $fastestRushTier === null) {
            throw $this->badRequest('Choose the fastest rush turnaround you can support');
        }
        $rushMinutes = ['HOURS_24' => 1440, 'HOURS_12' => 720, 'HOURS_6' => 360, 'HOURS_3' => 180];
        if ($acceptsRushOrders && $fastestRushTier && $rushMinutes[$fastestRushTier] >= $normalDeliveryMinutes) {
            throw $this->badRequest('Normal delivery must be slower than the fastest supported rush tier');
        }
    }

    private function insertPackages(string $serviceId, array $packages): void
    {
        DB::table('ServicePackage')->insert(array_map(fn (array $package): array => [
            'id' => (string) Str::uuid(),
            'serviceId' => $serviceId,
            'tier' => $package['tier'],
            'name' => trim($package['name']),
            'description' => trim($package['description']),
            'priceCentavos' => $package['priceCentavos'],
            'deliveryDays' => $package['deliveryDays'],
            'revisionLimit' => $package['revisionLimit'],
            'isActive' => true,
        ], $packages));
    }

    private function conditionalStatusUpdate(string $userId, string $serviceId, string $currentStatus, array $changes): void
    {
        $updated = DB::table('Service')->where('id', $serviceId)->where('providerId', $userId)
            ->whereNull('deletedAt')->where('status', $currentStatus)->update([...$changes, 'updatedAt' => now()]);
        if ($updated !== 1) {
            throw $this->conflict('The listing changed in another session. Refresh and try again.');
        }
    }

    private function profileResponse(object $profile): array
    {
        $data = (array) $profile;
        $data['skills'] = $this->decodeSkills($profile->skills);
        $data['isAvailable'] = (bool) $profile->isAvailable;
        $data['maxActiveOrders'] = (int) $profile->maxActiveOrders;
        $data['maxPendingOrders'] = (int) $profile->maxPendingOrders;
        foreach (['createdAt', 'updatedAt'] as $field) {
            if (! empty($data[$field])) {
                $data[$field] = CarbonImmutable::parse($data[$field])->toISOString();
            }
        }

        return $data;
    }

    private function mediaResponse(object $media): array
    {
        $response = (array) $media;
        unset($response['serviceStatus']);
        $response['sizeBytes'] = (int) $response['sizeBytes'];
        $response['sortOrder'] = (int) $response['sortOrder'];
        $response['createdAt'] = CarbonImmutable::parse($response['createdAt'])->toISOString();

        return $response;
    }

    private function safeOriginalName(UploadedFile $file): string
    {
        $name = basename(str_replace('\\', '/', $file->getClientOriginalName()));

        return mb_substr($name === '' ? 'upload' : $name, 0, 255);
    }

    private function requireVerified(string $userId): void
    {
        if (DB::table('StudentProfile')->where('userId', $userId)->value('verificationStatus') !== 'APPROVED') {
            throw $this->badRequest('Student verification approval is required');
        }
    }

    private function decodeSkills(mixed $skills): array
    {
        if (is_array($skills)) {
            return $skills;
        }
        $decoded = json_decode((string) $skills, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }

    private function nullableTrim(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => $message, 'error' => 'Bad Request', 'statusCode' => 400,
        ], 400));
    }

    private function conflict(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => $message, 'error' => 'Conflict', 'statusCode' => 409,
        ], 409));
    }

    private function notFound(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => $message, 'error' => 'Not Found', 'statusCode' => 404,
        ], 404));
    }
}
