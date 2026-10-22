<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

class PublicProviderService
{
    public function __construct(private readonly MarketplaceService $marketplace) {}

    public function profile(string $userId): array
    {
        $provider = $this->providerQuery()->where('user.id', $userId)->first();
        if (! $provider) {
            throw $this->notFound();
        }

        $review = DB::table('Review as review')
            ->join('Order as order', 'order.id', '=', 'review.orderId')
            ->where('review.revieweeId', $userId)
            ->where('order.status', 'COMPLETED')
            ->selectRaw('AVG(review.overallRating) AS averageRating, COUNT(*) AS reviewCount')
            ->first();
        $completedOrders = DB::table('Order')->where('providerId', $userId)->where('status', 'COMPLETED')->count();
        $services = collect($this->marketplace->publicServicesForProvider($userId))->map(function (array $service) use ($review): array {
            $service['rating'] = (float) ($review->averageRating ?? 0);
            $service['reviews'] = (int) ($review->reviewCount ?? 0);
            unset($service['acceptingOrders']);

            return $service;
        })->all();

        return ['data' => [
            'id' => $provider->id,
            'displayName' => $provider->displayName,
            'hasAvatar' => filled($provider->avatarPath),
            'avatarVersion' => CarbonImmutable::parse($provider->updatedAt)->getTimestampMs(),
            'memberSince' => CarbonImmutable::parse($provider->createdAt)->toISOString(),
            'headline' => $provider->headline,
            'bio' => $provider->bio,
            'skills' => $this->decodeSkills($provider->skills),
            'isAvailable' => (bool) $provider->isAvailable,
            'socialLinks' => [
                'instagram' => $provider->instagramUrl,
                'linkedin' => $provider->linkedinUrl,
                'x' => $provider->xUrl,
                'portfolio' => $provider->portfolioUrl,
            ],
            'verified' => $provider->verificationStatus === 'APPROVED',
            'program' => $provider->program,
            'school' => [
                'id' => $provider->schoolId,
                'name' => $provider->schoolName,
                'shortName' => $provider->schoolShortName,
                'city' => $provider->schoolCity,
            ],
            'rating' => (float) ($review->averageRating ?? 0),
            'reviewCount' => (int) ($review->reviewCount ?? 0),
            'completedOrders' => $completedOrders,
            'services' => $services,
        ]];
    }

    public function reviews(string $userId, int $page, int $pageSize): array
    {
        if (! $this->providerQuery()->where('user.id', $userId)->exists()) {
            throw $this->notFound();
        }

        $base = DB::table('Review as review')
            ->join('Order as order', 'order.id', '=', 'review.orderId')
            ->join('User as reviewer', 'reviewer.id', '=', 'review.reviewerId')
            ->where('review.revieweeId', $userId)
            ->where('order.status', 'COMPLETED');
        $total = (clone $base)->count('review.id');
        $totalPages = max(1, (int) ceil($total / $pageSize));
        $safePage = min($page, $totalPages);
        $rows = $base->orderByDesc('review.createdAt')
            ->forPage($safePage, $pageSize)
            ->get([
                'review.id', 'review.overallRating', 'review.qualityRating', 'review.communicationRating',
                'review.timelinessRating', 'review.comment', 'review.createdAt', 'reviewer.displayName as reviewerName',
                'order.titleSnapshot as serviceTitle',
            ]);
        $groups = DB::table('Review as review')
            ->join('Order as order', 'order.id', '=', 'review.orderId')
            ->where('review.revieweeId', $userId)->where('order.status', 'COMPLETED')
            ->groupBy('review.overallRating')->selectRaw('review.overallRating, COUNT(*) AS aggregate')
            ->pluck('aggregate', 'overallRating');
        $average = $total === 0 ? 0 : collect($groups)->reduce(
            fn (float $sum, int $count, int|string $rating): float => $sum + ((int) $rating * $count),
            0.0,
        ) / $total;

        return [
            'data' => $rows->map(fn (object $row): array => [
                'id' => $row->id,
                'overallRating' => (int) $row->overallRating,
                'qualityRating' => $row->qualityRating === null ? null : (int) $row->qualityRating,
                'communicationRating' => $row->communicationRating === null ? null : (int) $row->communicationRating,
                'timelinessRating' => $row->timelinessRating === null ? null : (int) $row->timelinessRating,
                'comment' => $row->comment,
                'createdAt' => CarbonImmutable::parse($row->createdAt)->toISOString(),
                'reviewerLabel' => $this->reviewerLabel($row->reviewerName),
                'serviceTitle' => $row->serviceTitle,
            ])->all(),
            'summary' => [
                'average' => round($average, 2),
                'total' => $total,
                'distribution' => collect([5, 4, 3, 2, 1])->map(fn (int $rating): array => [
                    'rating' => $rating,
                    'count' => (int) ($groups[$rating] ?? 0),
                ])->all(),
            ],
            'pagination' => ['page' => $safePage, 'pageSize' => $pageSize, 'total' => $total, 'totalPages' => $totalPages],
        ];
    }

    private function providerQuery()
    {
        return DB::table('User as user')
            ->join('ProviderProfile as provider', 'provider.userId', '=', 'user.id')
            ->join('StudentProfile as student', 'student.userId', '=', 'user.id')
            ->join('School as school', 'school.id', '=', 'student.schoolId')
            ->where('user.status', 'ACTIVE')->where('school.status', 'ACTIVE')
            ->whereExists(fn ($role) => $role->selectRaw('1')->from('UserRoleAssignment as assignment')
                ->whereColumn('assignment.userId', 'user.id')->where('assignment.role', 'PROVIDER'))
            ->select([
                'user.id', 'user.displayName', 'user.avatarPath', 'user.createdAt', 'user.updatedAt',
                'provider.headline', 'provider.bio', 'provider.skills', 'provider.isAvailable',
                'provider.instagramUrl', 'provider.linkedinUrl', 'provider.xUrl', 'provider.portfolioUrl',
                'student.program', 'student.verificationStatus', 'school.id as schoolId', 'school.name as schoolName',
                'school.shortName as schoolShortName', 'school.city as schoolCity',
            ]);
    }

    private function decodeSkills(mixed $skills): array
    {
        if (is_array($skills)) {
            return $skills;
        }
        $decoded = json_decode((string) $skills, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }

    private function reviewerLabel(string $displayName): string
    {
        $parts = preg_split('/\s+/', trim($displayName), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if ($parts === []) {
            return 'CampusGig client';
        }
        if (count($parts) === 1) {
            return $parts[0];
        }

        return $parts[0].' '.mb_substr($parts[array_key_last($parts)], 0, 1).'.';
    }

    private function notFound(): HttpResponseException
    {
        return new HttpResponseException(response()->json([
            'message' => 'Provider profile not found', 'error' => 'Not Found', 'statusCode' => 404,
        ], 404));
    }
}
