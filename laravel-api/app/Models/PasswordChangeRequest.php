<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class PasswordChangeRequest extends Model
{
    use UsesPrismaUuid;

    protected $table = 'PasswordChangeRequest';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = [
        'userId', 'newPasswordHash', 'tokenHash', 'status', 'expiresAt', 'respondedAt',
    ];

    protected $hidden = ['newPasswordHash', 'tokenHash'];

    protected function casts(): array
    {
        return ['expiresAt' => 'datetime', 'respondedAt' => 'datetime'];
    }
}
