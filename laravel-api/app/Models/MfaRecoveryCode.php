<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class MfaRecoveryCode extends Model
{
    use UsesPrismaUuid;

    protected $table = 'MfaRecoveryCode';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = ['userId', 'codeHash', 'usedAt'];

    protected function casts(): array
    {
        return ['usedAt' => 'datetime'];
    }
}
