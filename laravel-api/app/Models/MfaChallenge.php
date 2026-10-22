<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class MfaChallenge extends Model
{
    use UsesPrismaUuid;

    protected $table = 'MfaChallenge';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = ['userId', 'tokenHash', 'attempts', 'expiresAt', 'consumedAt'];

    protected function casts(): array
    {
        return ['attempts' => 'integer', 'expiresAt' => 'datetime', 'consumedAt' => 'datetime'];
    }
}
