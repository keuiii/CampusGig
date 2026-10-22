<?php

namespace App\Services;

use App\Services\Storage\PrivateMediaStorage;
use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Throwable;

class ProfileService
{
    public function __construct(private readonly PrivateMediaStorage $storage) {}

    public function updateAvatar(string $userId, UploadedFile $file): array
    {
        $previous = DB::table('User')->where('id', $userId)->value('avatarPath');
        $key = $this->storage->storeAvatar($file);
        try {
            $changed = DB::table('User')->where('id', $userId)->update(['avatarPath' => $key, 'updatedAt' => now()]);
            if ($changed !== 1) {
                throw $this->notFound('User not found');
            }
        } catch (Throwable $error) {
            $this->storage->deleteAvatar($key);
            throw $error;
        }
        if (is_string($previous) && $previous !== $key) {
            $this->storage->deleteAvatar($previous);
        }

        return ['data' => ['hasAvatar' => true]];
    }

    public function avatarPath(string $userId): string
    {
        $path = DB::table('User')->where('id', $userId)->value('avatarPath');
        if (! is_string($path) || $path === '') {
            throw $this->notFound('Profile picture not found');
        }

        return $path;
    }

    public function student(string $userId): array
    {
        $profile = DB::table('StudentProfile')->where('userId', $userId)->first();
        if (! $profile) {
            return ['data' => null];
        }
        $school = DB::table('School')->where('id', $profile->schoolId)->first();

        return ['data' => $this->studentResponse($profile, $school)];
    }

    public function updateStudent(string $userId, array $input): array
    {
        if (! DB::table('School')->where('id', $input['schoolId'])->where('status', 'ACTIVE')->exists()) {
            throw $this->badRequest('Select an active participating school');
        }
        $data = [
            'schoolId' => $input['schoolId'], 'program' => trim($input['program']),
            'yearLevel' => (int) $input['yearLevel'], 'bio' => isset($input['bio']) && trim($input['bio']) !== '' ? trim($input['bio']) : null,
        ];
        if (DB::table('StudentProfile')->where('userId', $userId)->exists()) {
            DB::table('StudentProfile')->where('userId', $userId)->update($data);
        } else {
            DB::table('StudentProfile')->insert([
                'userId' => $userId, ...$data, 'verificationStatus' => 'UNSUBMITTED',
                'ratingAverage' => 0, 'reviewCount' => 0, 'completedOrderCount' => 0,
            ]);
        }

        return $this->student($userId);
    }

    private function studentResponse(object $profile, ?object $school): array
    {
        $data = (array) $profile;
        $data['yearLevel'] = $profile->yearLevel === null ? null : (int) $profile->yearLevel;
        $data['ratingAverage'] = (float) $profile->ratingAverage;
        $data['reviewCount'] = (int) $profile->reviewCount;
        $data['completedOrderCount'] = (int) $profile->completedOrderCount;
        $data['verifiedAt'] = $profile->verifiedAt ? CarbonImmutable::parse($profile->verifiedAt)->toISOString() : null;
        $data['school'] = $school ? $this->schoolResponse($school) : null;

        return $data;
    }

    private function schoolResponse(object $school): array
    {
        $data = (array) $school;
        $data['createdAt'] = CarbonImmutable::parse($school->createdAt)->toISOString();
        $data['updatedAt'] = CarbonImmutable::parse($school->updatedAt)->toISOString();

        return $data;
    }

    private function badRequest(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Bad Request', 'statusCode' => 400], 400));
    }

    private function notFound(string $message): HttpResponseException
    {
        return new HttpResponseException(response()->json(['message' => $message, 'error' => 'Not Found', 'statusCode' => 404], 404));
    }
}
