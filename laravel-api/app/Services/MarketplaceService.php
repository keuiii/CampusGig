<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class MarketplaceService
{
    private const PAGE_SIZE = 20;

    public function list(array $filters, ?string $savedByUserId = null): array
    {
        $page = (int) ($filters['page'] ?? 1);
        $query = $this->availableServicesQuery();

        if ($savedByUserId) {
            $query->whereExists(fn (Builder $saved): Builder => $saved->selectRaw('1')->from('SavedService as saved')
                ->whereColumn('saved.serviceId', 'available.id')->where('saved.userId', $savedByUserId));
        }
        $search = strtolower(trim(preg_replace('/\s+/', ' ', $filters['query'] ?? '') ?? ''));
        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(function (Builder $where) use ($like): void {
                $where->whereRaw('LOWER(available.title) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(available.description) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(available.providerName) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(available.categoryName) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(available.schoolName) LIKE ?', [$like])
                    ->orWhereRaw('LOWER(available.schoolShortName) LIKE ?', [$like])
                    ->orWhereRaw("LOWER(COALESCE(CAST(available.providerSkills AS CHAR), '')) LIKE ?", [$like]);
            });
        }
        if (isset($filters['category'])) {
            $query->where('available.categoryName', $filters['category']);
        }
        if (isset($filters['schoolId'])) {
            $query->where('available.schoolId', $filters['schoolId']);
        }
        if (isset($filters['minimumRating'])) {
            $query->where('available.ratingAverage', '>=', $filters['minimumRating']);
        }
        if (isset($filters['maximumDeliveryDays'])) {
            $query->where('available.minimumDeliveryMinutes', '<=', $filters['maximumDeliveryDays'] * 1440);
        }
        $this->applyBudget($query, $filters['budgetRange'] ?? 'any');

        $total = (clone $query)->count('available.id');
        $this->applySort($query, $filters['sort'] ?? 'recommended', $search);
        $rows = $query->forPage($page, self::PAGE_SIZE)->get($this->serviceColumns());

        return [
            'data' => $this->hydrateResponses($rows),
            'page' => $page,
            'pageSize' => self::PAGE_SIZE,
            'total' => $total,
            'hasMore' => $page * self::PAGE_SIZE < $total,
        ];
    }

    public function find(string $id): array
    {
        $row = $this->availableServicesQuery()->where('available.id', $id)->first($this->serviceColumns());
        if (! $row) {
            throw $this->notFound('Service not found');
        }

        return $this->hydrateResponses(collect([$row]))[0];
    }

    public function publicServicesForProvider(string $providerId): array
    {
        $rows = $this->availableServicesQuery(false)
            ->where('available.providerId', $providerId)
            ->orderByDesc('available.publishedAt')
            ->limit(12)
            ->get($this->serviceColumns());

        return $this->hydrateResponses($rows);
    }

    public function savedIds(string $userId): array
    {
        return ['data' => DB::table('SavedService')->where('userId', $userId)->pluck('serviceId')->all()];
    }

    public function save(string $userId, string $serviceId): array
    {
        $this->find($serviceId);
        DB::table('SavedService')->insertOrIgnore(['userId' => $userId, 'serviceId' => $serviceId, 'createdAt' => now()]);

        return ['saved' => true];
    }

    public function unsave(string $userId, string $serviceId): array
    {
        DB::table('SavedService')->where('userId', $userId)->where('serviceId', $serviceId)->delete();

        return ['saved' => false];
    }

    public function publicMedia(string $serviceId, string $mediaId): object
    {
        $media = DB::table('ServiceMedia as media')
            ->join('Service as service', 'service.id', '=', 'media.serviceId')
            ->join('StudentProfile as student', 'student.userId', '=', 'service.providerId')
            ->join('School as school', 'school.id', '=', 'student.schoolId')
            ->where('media.id', $mediaId)->where('media.serviceId', $serviceId)
            ->where('service.status', 'PUBLISHED')->whereNull('service.deletedAt')->where('school.status', 'ACTIVE')
            ->select(['media.storagePath', 'media.mimeType', 'media.originalName'])->first();
        if (! $media) {
            throw $this->notFound('Service media not found');
        }
        if (! preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/', $media->storagePath)) {
            throw new \RuntimeException('Stored service media key is invalid.');
        }

        return $media;
    }

    private function availableServicesQuery(bool $requireProviderAvailable = true): Builder
    {
        $packagePrices = DB::table('ServicePackage')->where('isActive', true)->groupBy('serviceId')
            ->selectRaw('serviceId, MIN(priceCentavos) AS packageMinimumPrice, MIN(deliveryDays) * 1440 AS packageMinimumDeliveryMinutes');

        $available = DB::table('Service as service')
            ->join('User as provider', 'provider.id', '=', 'service.providerId')
            ->join('ProviderProfile as providerProfile', 'providerProfile.userId', '=', 'provider.id')
            ->join('StudentProfile as student', 'student.userId', '=', 'provider.id')
            ->join('School as school', 'school.id', '=', 'student.schoolId')
            ->join('Category as category', 'category.id', '=', 'service.categoryId')
            ->leftJoinSub($packagePrices, 'packagePrices', 'packagePrices.serviceId', '=', 'service.id')
            ->select([
                'service.id', 'service.title', 'service.description', 'service.pricingModel', 'service.basePriceCentavos',
                'service.normalDeliveryMinutes', 'service.includedRevisionLimit', 'service.acceptsRushOrders', 'service.fastestRushTier',
                'service.providerId', 'service.publishedAt', 'provider.displayName as providerName', 'provider.avatarPath',
                'provider.updatedAt as providerUpdatedAt', 'student.program', 'student.schoolId', 'student.ratingAverage',
                'student.reviewCount', 'school.name as schoolName', 'school.shortName as schoolShortName',
                'category.name as categoryName', 'providerProfile.skills as providerSkills', 'providerProfile.isAvailable as providerIsAvailable',
                'providerProfile.maxPendingOrders',
            ])
            ->selectRaw("CASE WHEN service.pricingModel = 'SINGLE_PRICE_V2' THEN service.basePriceCentavos ELSE packagePrices.packageMinimumPrice END AS minimumPrice")
            ->selectRaw("CASE WHEN service.pricingModel = 'SINGLE_PRICE_V2' THEN service.normalDeliveryMinutes ELSE packagePrices.packageMinimumDeliveryMinutes END AS minimumDeliveryMinutes")
            ->where('service.status', 'PUBLISHED')->whereNull('service.deletedAt')
            ->where('school.status', 'ACTIVE')
            ->where(function (Builder $valid): void {
                $valid->where(function (Builder $single): void {
                    $single->where('service.pricingModel', 'SINGLE_PRICE_V2')->whereNotNull('service.basePriceCentavos')
                        ->whereNotNull('service.normalDeliveryMinutes')->whereNotNull('service.includedRevisionLimit');
                })->orWhere(function (Builder $legacy): void {
                    $legacy->where('service.pricingModel', 'LEGACY_PACKAGES')->whereNotNull('packagePrices.packageMinimumPrice');
                });
            });

        if ($requireProviderAvailable) {
            $available->where('providerProfile.isAvailable', true);
        }

        return DB::query()->fromSub($available, 'available');
    }

    private function serviceColumns(): array
    {
        return [
            'available.id', 'available.title', 'available.description', 'available.pricingModel', 'available.basePriceCentavos',
            'available.normalDeliveryMinutes', 'available.includedRevisionLimit', 'available.acceptsRushOrders', 'available.fastestRushTier',
            'available.providerId', 'available.publishedAt', 'available.providerName', 'available.avatarPath',
            'available.providerUpdatedAt', 'available.program', 'available.schoolId', 'available.ratingAverage',
            'available.reviewCount', 'available.schoolName', 'available.categoryName', 'available.providerIsAvailable', 'available.maxPendingOrders',
            'available.minimumPrice', 'available.minimumDeliveryMinutes',
        ];
    }

    private function hydrateResponses(Collection $rows): array
    {
        if ($rows->isEmpty()) {
            return [];
        }
        $ids = $rows->pluck('id')->all();
        $providers = $rows->pluck('providerId')->unique()->values()->all();
        $packages = DB::table('ServicePackage')->whereIn('serviceId', $ids)->where('isActive', true)->orderBy('priceCentavos')->get()->groupBy('serviceId');
        $media = DB::table('ServiceMedia')->whereIn('serviceId', $ids)->orderBy('kind')->orderBy('sortOrder')->get()->groupBy('serviceId');
        $pending = DB::table('Order')->whereIn('providerId', $providers)->where('status', 'REQUESTED')->groupBy('providerId')->selectRaw('providerId, COUNT(*) AS aggregate')->pluck('aggregate', 'providerId');

        return $rows->map(function (object $row) use ($packages, $media, $pending): array {
            $servicePackages = collect($packages->get($row->id, []))->map(fn (object $package): array => [
                'id' => $package->id, 'serviceId' => $package->serviceId, 'tier' => $package->tier,
                'name' => $package->name, 'description' => $package->description,
                'priceCentavos' => (int) $package->priceCentavos, 'deliveryDays' => (int) $package->deliveryDays,
                'revisionLimit' => (int) $package->revisionLimit, 'isActive' => (bool) $package->isActive,
            ])->all();
            $serviceMedia = collect($media->get($row->id, []));
            $nameParts = preg_split('/\s+/', trim($row->providerName)) ?: [];
            $initials = implode('', array_map(fn (string $part): string => mb_substr($part, 0, 1), array_slice($nameParts, 0, 2)));
            $deliveryMinutes = $row->pricingModel === 'SINGLE_PRICE_V2'
                ? (int) $row->normalDeliveryMinutes
                : (int) (($servicePackages[0]['deliveryDays'] ?? 0) * 1440);

            return [
                'id' => $row->id, 'title' => $row->title, 'description' => $row->description,
                'pricingModel' => $row->pricingModel ?: 'LEGACY_PACKAGES',
                'basePriceCentavos' => $row->basePriceCentavos === null ? null : (int) $row->basePriceCentavos,
                'normalDeliveryMinutes' => $row->normalDeliveryMinutes === null ? null : (int) $row->normalDeliveryMinutes,
                'includedRevisionLimit' => $row->includedRevisionLimit === null ? null : (int) $row->includedRevisionLimit,
                'acceptsRushOrders' => (bool) $row->acceptsRushOrders, 'fastestRushTier' => $row->fastestRushTier,
                'providerId' => $row->providerId, 'provider' => $row->providerName, 'initials' => $initials,
                'providerHasAvatar' => filled($row->avatarPath),
                'providerAvatarVersion' => CarbonImmutable::parse($row->providerUpdatedAt)->getTimestampMs(),
                'program' => $row->program ?? '', 'schoolId' => $row->schoolId ?? '', 'school' => $row->schoolName ?? '',
                'category' => $row->categoryName, 'price' => ((int) $row->minimumPrice) / 100,
                'rating' => (float) ($row->ratingAverage ?? 0), 'reviews' => (int) ($row->reviewCount ?? 0),
                'acceptingOrders' => (bool) $row->providerIsAvailable
                    && (int) ($pending[$row->providerId] ?? 0) < (int) ($row->maxPendingOrders ?? 50),
                'publishedAt' => $row->publishedAt ? CarbonImmutable::parse($row->publishedAt)->toISOString() : null,
                'delivery' => $this->formatDelivery($deliveryMinutes), 'packages' => $servicePackages,
                'coverMediaId' => optional($serviceMedia->firstWhere('kind', 'COVER'))->id,
                'portfolio' => $serviceMedia->where('kind', 'PORTFOLIO')->values()->map(fn (object $item): array => [
                    'id' => $item->id, 'originalName' => $item->originalName, 'mimeType' => $item->mimeType,
                ])->all(),
            ];
        })->all();
    }

    private function applyBudget(Builder $query, string $range): void
    {
        $bounds = match ($range) {
            'under-500' => [0, 50000], '500-999' => [50000, 100000], '1000-2499' => [100000, 250000],
            '2500-4999' => [250000, 500000], '5000-plus' => [500000, null], default => null,
        };
        if (! $bounds) {
            return;
        }
        $query->where('available.minimumPrice', '>=', $bounds[0]);
        if ($bounds[1] !== null) {
            $query->where('available.minimumPrice', '<', $bounds[1]);
        }
    }

    private function applySort(Builder $query, string $sort, string $search): void
    {
        if ($sort === 'rating') {
            $query->orderByDesc('available.ratingAverage');
        } elseif ($sort === 'price-low') {
            $query->orderByRaw('available.minimumPrice IS NULL')->orderBy('available.minimumPrice');
        } elseif ($sort === 'delivery-fast') {
            $query->orderByRaw('available.minimumDeliveryMinutes IS NULL')->orderBy('available.minimumDeliveryMinutes');
        } elseif ($sort === 'recommended' && $search !== '') {
            $query->orderByRaw('CASE WHEN LOWER(available.title) = ? THEN 0 WHEN LOWER(available.title) LIKE ? THEN 1 ELSE 2 END', [$search, "%{$search}%"])
                ->orderByDesc('available.ratingAverage');
        }
        $query->orderByDesc('available.publishedAt')->orderByDesc('available.id');
    }

    private function formatDelivery(int $minutes): string
    {
        if ($minutes % 1440 === 0) {
            return ($days = intdiv($minutes, 1440)).' day'.($days === 1 ? '' : 's');
        }
        if ($minutes % 60 === 0) {
            return ($hours = intdiv($minutes, 60)).' hour'.($hours === 1 ? '' : 's');
        }

        return "{$minutes} minutes";
    }

    private function notFound(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Not Found', 'statusCode' => 404], 404));
    }
}
