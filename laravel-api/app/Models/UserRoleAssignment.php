<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserRoleAssignment extends Model
{
    protected $table = 'UserRoleAssignment';

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    public $incrementing = false;

    protected $fillable = ['userId', 'role'];
}
