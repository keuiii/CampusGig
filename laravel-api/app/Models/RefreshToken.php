<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class RefreshToken extends Model
{
    use UsesPrismaUuid;

    protected $table = 'RefreshToken';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected $fillable = ['sessionId', 'tokenHash', 'expiresAt', 'usedAt', 'revokedAt'];

    protected function casts(): array
    {
        return [
            'expiresAt' => 'datetime',
            'usedAt' => 'datetime',
            'revokedAt' => 'datetime',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(AuthSession::class, 'sessionId');
    }
}
