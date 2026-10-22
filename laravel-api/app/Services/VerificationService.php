<?php

namespace App\Services;

use App\Services\Storage\PrivateMediaStorage;
use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

class VerificationService
{
    public function __construct(private readonly PrivateMediaStorage $storage) {}

    public function submit(string $userId, UploadedFile $file): array
    {
        $key = $this->storage->storeStudentId($file);
        try {
            $request = DB::transaction(function () use ($userId, $key): object {
                $profile = DB::table('StudentProfile')->where('userId', $userId)->lockForUpdate()->first();
                if (! $profile) {
                    throw $this->badRequest('Complete your student profile before requesting verification');
                }
                if ($profile->verificationStatus === 'PENDING') {
                    throw $this->conflict('Your verification is already awaiting review');
                }
                if ($profile->verificationStatus === 'APPROVED') {
                    throw $this->conflict('Your account is already verified');
                }
                $id = (string) Str::uuid();
                $now = now();
                DB::table('VerificationRequest')->insert([
                    'id' => $id, 'userId' => $userId, 'schoolId' => $profile->schoolId,
                    'studentIdFilePath' => $key, 'status' => 'PENDING',
                    'submittedAt' => $now,
                ]);
                DB::table('StudentProfile')->where('userId', $userId)->update([
                    'verificationStatus' => 'PENDING', 'verifiedAt' => null,
                ]);

                return DB::table('VerificationRequest')->where('id', $id)->first();
            });
        } catch (Throwable $error) {
            $this->storage->deleteStudentId($key);
            throw $error;
        }

        return ['data' => [
            'id' => $request->id, 'status' => $request->status,
            'submittedAt' => $this->date($request->submittedAt),
        ]];
    }

    public function latest(string $userId): array
    {
        $request = DB::table('VerificationRequest')->where('userId', $userId)
            ->orderByDesc('submittedAt')->first();

        return ['data' => $request ? [
            'id' => $request->id, 'status' => $request->status,
            'submittedAt' => $this->date($request->submittedAt),
            'reviewedAt' => $this->date($request->reviewedAt),
            'rejectionReason' => $request->rejectionReason,
        ] : null];
    }

    public function listPending(string $reviewerId, bool $platformAdmin, ?string $cursor, int $limit): array
    {
        $schoolId = $platformAdmin ? null : $this->assignedSchool($reviewerId);
        $query = DB::table('VerificationRequest as request')
            ->join('School as school', 'school.id', '=', 'request.schoolId')
            ->join('User as user', 'user.id', '=', 'request.userId')
            ->leftJoin('StudentProfile as profile', 'profile.userId', '=', 'request.userId')
            ->where('request.status', 'PENDING');
        if ($schoolId) {
            $query->where('request.schoolId', $schoolId);
        }
        if ($cursor) {
            [$date, $id] = $this->decodeCursor($cursor, 'verification');
            $query->where(fn ($nested) => $nested->where('request.submittedAt', '>', $date)
                ->orWhere(fn ($same) => $same->where('request.submittedAt', $date)->where('request.id', '>', $id)));
        }
        $rows = $query->orderBy('request.submittedAt')->orderBy('request.id')->limit($limit + 1)->get([
            'request.id', 'request.userId', 'request.submittedAt', 'user.displayName', 'user.email',
            'profile.program', 'profile.yearLevel', 'school.name as schoolName', 'school.shortName as schoolShortName',
        ]);
        $hasMore = $rows->count() > $limit;
        $page = $hasMore ? $rows->take($limit) : $rows;
        $last = $page->last();

        return [
            'data' => $page->map(fn (object $row): array => [
                'id' => $row->id, 'userId' => $row->userId, 'name' => $row->displayName ?: 'Student',
                'email' => $row->email, 'program' => $row->program,
                'yearLevel' => $row->yearLevel === null ? null : (int) $row->yearLevel,
                'school' => $row->schoolName, 'schoolShortName' => $row->schoolShortName,
                'submittedAt' => $this->date($row->submittedAt), 'documentName' => 'Student ID',
            ])->values()->all(),
            'pagination' => [
                'hasMore' => $hasMore,
                'nextCursor' => $hasMore && $last ? $this->encodeCursor($last->submittedAt, $last->id) : null,
            ],
        ];
    }

    public function review(string $id, string $reviewerId, bool $approved, ?string $reason, bool $platformAdmin): array
    {
        $result = DB::transaction(function () use ($id, $reviewerId, $approved, $reason, $platformAdmin): array {
            $request = DB::table('VerificationRequest')->where('id', $id)->lockForUpdate()->first();
            if (! $request) {
                throw $this->notFound('Verification request not found');
            }
            if ($request->status !== 'PENDING') {
                throw $this->conflict('This request has already been reviewed');
            }
            if (! $platformAdmin && $request->schoolId !== $this->assignedSchool($reviewerId)) {
                throw $this->forbidden('You can only review students from your assigned school');
            }
            if (! $approved && (! is_string($reason) || trim($reason) === '')) {
                throw $this->badRequest('A rejection reason is required');
            }
            $status = $approved ? 'APPROVED' : 'REJECTED';
            $now = now();
            DB::table('VerificationRequest')->where('id', $id)->update([
                'status' => $status, 'reviewedAt' => $now, 'reviewedBy' => $reviewerId,
                'rejectionReason' => $approved ? null : trim((string) $reason),
            ]);
            DB::table('StudentProfile')->where('userId', $request->userId)->update([
                'verificationStatus' => $status, 'verifiedAt' => $approved ? $now : null,
            ]);
            if ($approved) {
                DB::table('UserRoleAssignment')->insertOrIgnore([
                    'userId' => $request->userId, 'role' => 'PROVIDER', 'createdAt' => $now,
                ]);
            }

            return ['id' => $id, 'status' => $status];
        });

        return ['data' => $result];
    }

    public function documentPath(string $id, string $reviewerId, bool $platformAdmin): string
    {
        $request = DB::table('VerificationRequest')->where('id', $id)->first();
        if (! $request) {
            throw $this->notFound('Verification request not found');
        }
        if (! $platformAdmin && $request->schoolId !== $this->assignedSchool($reviewerId)) {
            throw $this->forbidden('You can only view documents from your assigned school');
        }

        return $request->studentIdFilePath;
    }

    private function assignedSchool(string $userId): string
    {
        $schoolId = DB::table('SchoolAdminAssignment')->where('userId', $userId)->value('schoolId');
        if (! is_string($schoolId)) {
            throw $this->forbidden('No school is assigned to this administrator account');
        }

        return $schoolId;
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

    private function date(mixed $value): ?string
    {
        return $value ? CarbonImmutable::parse($value)->toISOString() : null;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return $this->error(400, 'Bad Request', $message);
    }

    private function forbidden(string $message): HttpResponseException
    {
        return $this->error(403, 'Forbidden', $message);
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
