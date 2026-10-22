<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;

class User extends Authenticatable
{
    use UsesPrismaUuid;

    protected $table = 'User';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'email', 'passwordHash', 'displayName', 'avatarPath', 'status',
        'lastSeenAt', 'emailVerifiedAt', 'mfaEnabledAt', 'mfaSecretCipher',
        'mfaPendingSecretCipher', 'mfaLastUsedStep', 'sessionVersion',
    ];

    protected $hidden = [
        'passwordHash', 'mfaSecretCipher', 'mfaPendingSecretCipher',
    ];

    protected function casts(): array
    {
        return [
            'lastSeenAt' => 'datetime',
            'emailVerifiedAt' => 'datetime',
            'mfaEnabledAt' => 'datetime',
            'mfaLastUsedStep' => 'integer',
            'sessionVersion' => 'integer',
        ];
    }

    public function roleAssignments(): HasMany
    {
        return $this->hasMany(UserRoleAssignment::class, 'userId');
    }

    public function authSessions(): HasMany
    {
        return $this->hasMany(AuthSession::class, 'userId');
    }
}
