<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class TrustedDevice extends Model
{
    use UsesPrismaUuid;

    protected $table = 'TrustedDevice';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = ['userId', 'tokenHash', 'expiresAt', 'lastUsedAt', 'revokedAt'];

    protected function casts(): array
    {
        return ['expiresAt' => 'datetime', 'lastUsedAt' => 'datetime', 'revokedAt' => 'datetime'];
    }
}
