<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class AccountCode extends Model
{
    use UsesPrismaUuid;

    protected $table = 'AccountCode';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = ['userId', 'purpose', 'codeHash', 'expiresAt', 'attempts', 'consumedAt'];

    protected function casts(): array
    {
        return [
            'expiresAt' => 'datetime',
            'consumedAt' => 'datetime',
            'attempts' => 'integer',
        ];
    }
}
