<?php

namespace App\Models;

use App\Models\Concerns\UsesPrismaUuid;
use Illuminate\Database\Eloquent\Model;

class School extends Model
{
    use UsesPrismaUuid;

    protected $table = 'School';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    protected $fillable = ['name', 'shortName', 'emailDomain', 'address', 'city', 'status'];
}
