<?php

namespace Tests\Unit;

use App\Http\Middleware\RequireRole;
use App\Models\User;
use App\Models\UserRoleAssignment;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Tests\TestCase;

final class RequireRoleTest extends TestCase
{
    public function test_administrator_routes_require_two_factor_authentication(): void
    {
        $request = Request::create('/api/v1/admin/dashboard');
        $request->attributes->set('auth.user', $this->userWithRole('ADMIN'));

        $response = (new RequireRole)->handle($request, fn () => response('allowed'), 'ADMIN');

        self::assertSame(403, $response->getStatusCode());
        self::assertSame(
            'Enable two-factor authentication before using administrator features',
            json_decode((string) $response->getContent(), true, 512, JSON_THROW_ON_ERROR)['message'],
        );
    }

    public function test_administrator_with_two_factor_authentication_can_continue(): void
    {
        $request = Request::create('/api/v1/admin/dashboard');
        $user = $this->userWithRole('ADMIN');
        $user->mfaEnabledAt = now();
        $request->attributes->set('auth.user', $user);

        $response = (new RequireRole)->handle($request, fn () => response('allowed'), 'ADMIN');

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('allowed', $response->getContent());
    }

    public function test_non_administrator_roles_keep_existing_behavior(): void
    {
        $request = Request::create('/api/v1/provider/dashboard');
        $request->attributes->set('auth.user', $this->userWithRole('PROVIDER'));

        $response = (new RequireRole)->handle($request, fn () => response('allowed'), 'PROVIDER');

        self::assertSame(200, $response->getStatusCode());
    }

    private function userWithRole(string $role): User
    {
        $assignment = new UserRoleAssignment;
        $assignment->role = $role;

        $user = new User;
        $user->setRelation('roleAssignments', new Collection([$assignment]));

        return $user;
    }
}
