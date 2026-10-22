<?php

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;
use Throwable;

class AdminService
{
    public function dashboard(): array
    {
        return [
            'registeredStudents' => DB::table('UserRoleAssignment')->where('role', 'STUDENT')->count(),
            'activeServices' => DB::table('Service')->where('status', 'PUBLISHED')->whereNull('deletedAt')->count(),
            'completedOrders' => DB::table('Order')->where('status', 'COMPLETED')->count(),
            'pendingVerifications' => DB::table('VerificationRequest')->where('status', 'PENDING')->count(),
        ];
    }

    public function pendingServices(?string $cursor, int $limit): array
    {
        $query = DB::table('Service')->where('status', 'PENDING_REVIEW')->whereNull('deletedAt');
        if ($cursor) {
            [$date, $id] = $this->decodeCursor($cursor, 'service queue');
            $query->where(fn ($nested) => $nested->where('updatedAt', '>', $date)
                ->orWhere(fn ($same) => $same->where('updatedAt', $date)->where('id', '>', $id)));
        }
        $rows = $query->orderBy('updatedAt')->orderBy('id')->limit($limit + 1)->get();
        $hasMore = $rows->count() > $limit;
        $page = $hasMore ? $rows->take($limit) : $rows;
        $last = $page->last();

        return [
            'data' => $page->map(fn (object $service): array => $this->serviceResponse($service))->values()->all(),
            'pagination' => [
                'hasMore' => $hasMore,
                'nextCursor' => $hasMore && $last ? $this->encodeCursor($last->updatedAt, $last->id) : null,
            ],
        ];
    }

    public function reviewService(string $id, string $adminId, bool $approved, ?string $reason): array
    {
        DB::transaction(function () use ($id, $adminId, $approved, $reason): void {
            $service = DB::table('Service')->where('id', $id)->whereNull('deletedAt')->lockForUpdate()->first();
            if (! $service) {
                throw $this->notFound('Service not found');
            }
            if ($service->status !== 'PENDING_REVIEW') {
                throw $this->conflict('Only services awaiting review can be moderated');
            }
            $packageCount = DB::table('ServicePackage')->where('serviceId', $id)->where('isActive', true)->count();
            if ($approved && $service->pricingModel === 'LEGACY_PACKAGES' && $packageCount === 0) {
                throw $this->badRequest('A legacy service must have an active package before approval');
            }
            if ($approved && $service->pricingModel === 'SINGLE_PRICE_V2'
                && ($packageCount > 0 || $service->basePriceCentavos === null
                    || $service->normalDeliveryMinutes === null || $service->includedRevisionLimit === null)) {
                throw $this->badRequest('The single-price service terms are incomplete or contradictory');
            }
            $now = now();
            DB::table('Service')->where('id', $id)->where('status', 'PENDING_REVIEW')->update($approved ? [
                'status' => 'PUBLISHED', 'publishedAt' => $now, 'reviewedAt' => $now,
                'reviewedBy' => $adminId, 'rejectionReason' => null, 'updatedAt' => $now,
            ] : [
                'status' => 'REJECTED', 'publishedAt' => null, 'reviewedAt' => $now,
                'reviewedBy' => $adminId, 'rejectionReason' => trim((string) $reason), 'updatedAt' => $now,
            ]);
        });

        return ['data' => $this->serviceResponse(DB::table('Service')->where('id', $id)->first(), false)];
    }

    public function schoolAdmins(?string $cursor, int $limit): array
    {
        $query = DB::table('SchoolAdminAssignment as assignment')
            ->join('User as user', 'user.id', '=', 'assignment.userId')
            ->join('School as school', 'school.id', '=', 'assignment.schoolId');
        if ($cursor) {
            [$date, $id] = $this->decodeCursor($cursor, 'school admin');
            $query->where(fn ($nested) => $nested->where('assignment.createdAt', '<', $date)
                ->orWhere(fn ($same) => $same->where('assignment.createdAt', $date)->where('assignment.userId', '<', $id)));
        }
        $rows = $query->orderByDesc('assignment.createdAt')->orderByDesc('assignment.userId')->limit($limit + 1)->get([
            'assignment.*', 'user.displayName', 'user.email', 'user.status as userStatus',
            'school.name as schoolName', 'school.shortName as schoolShortName',
        ]);
        $hasMore = $rows->count() > $limit;
        $page = $hasMore ? $rows->take($limit) : $rows;
        $last = $page->last();

        return [
            'data' => $page->map(fn (object $row): array => $this->schoolAdminResponse($row))->values()->all(),
            'pagination' => [
                'hasMore' => $hasMore,
                'nextCursor' => $hasMore && $last ? $this->encodeCursor($last->createdAt, $last->userId) : null,
            ],
        ];
    }

    public function assignSchoolAdmin(string $emailInput, string $schoolId): array
    {
        $email = strtolower(trim($emailInput));

        return DB::transaction(function () use ($email, $schoolId): array {
            $user = DB::table('User')->whereRaw('LOWER(email) = ?', [$email])->lockForUpdate()->first();
            if (! $user) {
                throw $this->notFound('Create the user account before assigning school administrator access');
            }
            if (! $user->emailVerifiedAt || $user->status !== 'ACTIVE') {
                throw $this->badRequest('The administrator account must be active and email verified');
            }
            $school = DB::table('School')->where('id', $schoolId)->lockForUpdate()->first();
            if (! $school || $school->status !== 'ACTIVE') {
                throw $this->badRequest('Select an active participating school');
            }
            $now = now();
            $assignment = DB::table('SchoolAdminAssignment')->where('userId', $user->id)->first();
            if ($assignment) {
                DB::table('SchoolAdminAssignment')->where('userId', $user->id)->update(['schoolId' => $schoolId]);
            } else {
                DB::table('SchoolAdminAssignment')->insert([
                    'userId' => $user->id, 'schoolId' => $schoolId, 'createdAt' => $now,
                ]);
            }
            DB::table('UserRoleAssignment')->insertOrIgnore([
                'userId' => $user->id, 'role' => 'SCHOOL_ADMIN', 'createdAt' => $now,
            ]);

            return $this->schoolAdmin($user->id);
        });
    }

    public function removeSchoolAdmin(string $userId): array
    {
        DB::transaction(function () use ($userId): void {
            $assignment = DB::table('SchoolAdminAssignment')->where('userId', $userId)->lockForUpdate()->first();
            if (! $assignment) {
                throw $this->notFound('School administrator assignment not found');
            }
            DB::table('SchoolAdminAssignment')->where('userId', $userId)->delete();
            DB::table('UserRoleAssignment')->where('userId', $userId)->where('role', 'SCHOOL_ADMIN')->delete();
        });

        return ['message' => 'School administrator access removed'];
    }

    private function schoolAdmin(string $userId): array
    {
        $row = DB::table('SchoolAdminAssignment as assignment')
            ->join('User as user', 'user.id', '=', 'assignment.userId')
            ->join('School as school', 'school.id', '=', 'assignment.schoolId')
            ->where('assignment.userId', $userId)->first([
                'assignment.*', 'user.displayName', 'user.email', 'user.status as userStatus',
                'school.name as schoolName', 'school.shortName as schoolShortName',
            ]);

        return $this->schoolAdminResponse($row);
    }

    private function schoolAdminResponse(object $row): array
    {
        return [
            'userId' => $row->userId, 'schoolId' => $row->schoolId,
            'createdAt' => $this->date($row->createdAt),
            'user' => ['id' => $row->userId, 'displayName' => $row->displayName, 'email' => $row->email, 'status' => $row->userStatus],
            'school' => ['id' => $row->schoolId, 'name' => $row->schoolName, 'shortName' => $row->schoolShortName],
        ];
    }

    private function serviceResponse(object $service, bool $includeProvider = true): array
    {
        $data = (array) $service;
        foreach (['publishedAt', 'reviewedAt', 'createdAt', 'updatedAt', 'deletedAt'] as $field) {
            $data[$field] = $service->{$field} ? $this->date($service->{$field}) : null;
        }
        $data['acceptsRushOrders'] = (bool) $service->acceptsRushOrders;
        $category = DB::table('Category')->where('id', $service->categoryId)->first();
        $data['category'] = $category ? $this->categoryResponse($category) : null;
        $data['packages'] = DB::table('ServicePackage')->where('serviceId', $service->id)->where('isActive', true)
            ->orderBy('priceCentavos')->get()->map(function (object $package): array {
                $item = (array) $package;
                foreach (['priceCentavos', 'deliveryDays', 'revisionLimit'] as $field) {
                    $item[$field] = (int) $item[$field];
                }
                $item['isActive'] = (bool) $item['isActive'];

                return $item;
            })->all();
        if ($includeProvider) {
            $provider = DB::table('User')->where('id', $service->providerId)->first(['id', 'displayName', 'email']);
            $student = DB::table('StudentProfile')->where('userId', $service->providerId)->first();
            $school = $student ? DB::table('School')->where('id', $student->schoolId)->first(['id', 'name', 'shortName']) : null;
            $data['provider'] = [
                'displayName' => $provider?->displayName, 'email' => $provider?->email,
                'studentProfile' => $student ? ['school' => $school ? (array) $school : null] : null,
            ];
        }

        return $data;
    }

    private function categoryResponse(object $category): array
    {
        $data = (array) $category;
        $data['isActive'] = (bool) $category->isActive;
        $data['sortOrder'] = (int) $category->sortOrder;

        return $data;
    }

    private function encodeCursor(mixed $date, string $id): string
    {
        return rtrim(strtr(base64_encode(json_encode(['date' => $this->date($date), 'id' => $id], JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    }

    private function decodeCursor(string $cursor, string $label): array
    {
        $decoded = base64_decode(strtr($cursor, '-_', '+/'), true);
        $value = $decoded === false ? null : json_decode($decoded, true);
        try {
            if (! is_array($value) || ! is_string($value['date'] ?? null) || ! is_string($value['id'] ?? null)) {
                throw new \InvalidArgumentException;
            }

            return [CarbonImmutable::parse($value['date']), $value['id']];
        } catch (Throwable) {
            throw $this->badRequest("Invalid {$label} cursor");
        }
    }

    private function date(mixed $value): string
    {
        return CarbonImmutable::parse($value)->toISOString();
    }

    private function badRequest(string $message): HttpResponseException
    {
        return $this->error(400, 'Bad Request', $message);
    }

    private function notFound(string $message): HttpResponseException
    {
        return $this->error(404, 'Not Found', $message);
    }

    private function conflict(string $message): HttpResponseException
    {
        return $this->error(409, 'Conflict', $message);
    }

    private function error(int $status, string $error, string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => $error, 'statusCode' => $status], $status));
    }
}
