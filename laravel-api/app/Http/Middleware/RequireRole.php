<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireRole
{
    public function handle(Request $request, Closure $next, string ...$roles): Response
    {
        /** @var User|null $user */
        $user = $request->attributes->get('auth.user');
        $assigned = $user?->roleAssignments->pluck('role')->all() ?? [];
        if (array_intersect($roles, $assigned) === []) {
            return response()->json(['message' => 'Forbidden', 'error' => 'Forbidden', 'statusCode' => 403], 403);
        }

        $requiresAdministratorMfa = array_intersect(['ADMIN', 'SCHOOL_ADMIN'], $roles) !== []
            && array_intersect(['ADMIN', 'SCHOOL_ADMIN'], $assigned) !== [];
        if ($requiresAdministratorMfa && ! $user?->mfaEnabledAt) {
            return response()->json([
                'message' => 'Enable two-factor authentication before using administrator features',
                'error' => 'Forbidden',
                'statusCode' => 403,
            ], 403);
        }

        return $next($request);
    }
}
