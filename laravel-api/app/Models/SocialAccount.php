<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class SocialAccount extends Model
{
    use UsesPrismaUuid;

    protected $table = 'SocialAccount';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    protected $fillable = ['userId', 'provider', 'providerUserId', 'providerEmail'];
}
