<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AuthSession extends Model
{
    use UsesPrismaUuid;

    protected $table = 'AuthSession';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = [
        'userId', 'clientType', 'deviceName', 'sessionVersion', 'expiresAt',
        'lastUsedAt', 'revokedAt', 'revokedReason',
    ];

    protected function casts(): array
    {
        return [
            'sessionVersion' => 'integer',
            'expiresAt' => 'datetime',
            'lastUsedAt' => 'datetime',
            'revokedAt' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'userId');
    }

    public function refreshTokens(): HasMany
    {
        return $this->hasMany(RefreshToken::class, 'sessionId');
    }
}
