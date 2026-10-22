<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\Auth\SessionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PromoteAdmin extends Command
{
    protected $signature = 'campusgig:admin:promote
                            {email : Email address of an existing verified account}';

    protected $description = 'Promote an existing verified CampusGig account to platform administrator';

    public function handle(SessionService $sessions): int
    {
        $email = strtolower(trim((string) $this->argument('email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
            $this->error('Enter a valid account email address.');

            return self::FAILURE;
        }

        $user = User::query()->where('email', $email)->first();
        if (! $user) {
            $this->error('No CampusGig account exists for that email address.');

            return self::FAILURE;
        }
        if ($user->status !== 'ACTIVE' || ! $user->emailVerifiedAt) {
            $this->error('The account must be active and email-verified before it can become an administrator.');

            return self::FAILURE;
        }
        if (UserRoleAssignment::query()->where('userId', $user->id)->where('role', 'ADMIN')->exists()) {
            $this->info('This account is already a platform administrator.');

            return self::SUCCESS;
        }

        DB::transaction(function () use ($user): void {
            UserRoleAssignment::query()->create([
                'userId' => $user->id,
                'role' => 'ADMIN',
            ]);
        });
        $sessions->revokeAll($user);

        $this->info('Administrator role granted. Existing sessions were revoked; sign in again and enable two-factor authentication.');

        return self::SUCCESS;
    }
}
