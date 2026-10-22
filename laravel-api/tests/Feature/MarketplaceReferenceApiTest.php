<?php

namespace Tests\Feature;

use App\Models\AuthSession;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\Auth\TokenCodec;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class MarketplaceReferenceApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['campusgig.jwt_secret' => 'test-only-secret-with-at-least-thirty-two-characters', 'campusgig.access_token_ttl_seconds' => 900]);

        Schema::create('User', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('email')->unique();
            $table->string('passwordHash');
            $table->string('displayName');
            $table->string('avatarPath')->nullable();
            $table->string('status');
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
            $table->timestamp('emailVerifiedAt')->nullable();
            $table->timestamp('mfaEnabledAt')->nullable();
            $table->text('mfaSecretCipher')->nullable();
            $table->text('mfaPendingSecretCipher')->nullable();
            $table->integer('mfaLastUsedStep')->nullable();
            $table->integer('sessionVersion')->default(0);
        });
        Schema::create('UserRoleAssignment', function (Blueprint $table): void {
            $table->uuid('userId');
            $table->string('role');
            $table->timestamp('createdAt');
            $table->primary(['userId', 'role']);
        });
        Schema::create('AuthSession', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('clientType');
            $table->string('deviceName');
            $table->integer('sessionVersion');
            $table->timestamp('expiresAt');
            $table->timestamp('lastUsedAt');
            $table->timestamp('revokedAt')->nullable();
            $table->string('revokedReason')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('Category', function (Blueprint $table): void {
            $table->string('id')->primary();
            $table->string('name');
            $table->string('icon')->nullable();
            $table->string('color')->nullable();
            $table->boolean('isActive')->default(true);
            $table->integer('sortOrder')->default(0);
        });
        Schema::create('School', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('shortName');
            $table->string('emailDomain')->nullable();
            $table->string('address')->nullable();
            $table->string('city')->default('Lipa City');
            $table->string('status')->default('PENDING');
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
        });
        Schema::create('ProviderProfile', function (Blueprint $table): void {
            $table->uuid('userId')->primary();
            $table->string('headline')->nullable();
            $table->text('bio')->nullable();
            $table->text('skills')->nullable();
            $table->boolean('isAvailable');
            $table->integer('maxActiveOrders')->default(5);
            $table->integer('maxPendingOrders')->default(50);
            $table->string('instagramUrl')->nullable();
            $table->string('linkedinUrl')->nullable();
            $table->string('xUrl')->nullable();
            $table->string('portfolioUrl')->nullable();
            $table->timestamp('createdAt')->nullable();
            $table->timestamp('updatedAt')->nullable();
        });
        Schema::create('StudentProfile', function (Blueprint $table): void {
            $table->uuid('userId')->primary();
            $table->uuid('schoolId');
            $table->text('studentNumberCipher')->nullable();
            $table->string('program')->nullable();
            $table->integer('yearLevel')->nullable();
            $table->text('bio')->nullable();
            $table->string('verificationStatus')->default('UNSUBMITTED');
            $table->timestamp('verifiedAt')->nullable();
            $table->decimal('ratingAverage', 3, 2)->default(0);
            $table->integer('reviewCount')->default(0);
            $table->integer('completedOrderCount')->default(0);
        });
        Schema::create('VerificationRequest', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->uuid('schoolId');
            $table->string('studentIdFilePath');
            $table->string('status')->default('PENDING');
            $table->timestamp('submittedAt');
            $table->timestamp('reviewedAt')->nullable();
            $table->uuid('reviewedBy')->nullable();
            $table->text('rejectionReason')->nullable();
        });
        Schema::create('SchoolAdminAssignment', function (Blueprint $table): void {
            $table->uuid('userId')->primary();
            $table->uuid('schoolId');
            $table->timestamp('createdAt');
        });
        Schema::create('Service', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerId');
            $table->string('categoryId');
            $table->string('title')->nullable();
            $table->string('slug')->nullable();
            $table->text('description')->nullable();
            $table->string('status');
            $table->timestamp('publishedAt')->nullable();
            $table->timestamp('deletedAt')->nullable();
            $table->string('pricingModel')->nullable();
            $table->integer('basePriceCentavos')->nullable();
            $table->integer('normalDeliveryMinutes')->nullable();
            $table->integer('includedRevisionLimit')->nullable();
            $table->boolean('acceptsRushOrders')->default(false);
            $table->string('fastestRushTier')->nullable();
            $table->string('deliveryMethod')->default('ONLINE');
            $table->string('campusLocation')->nullable();
            $table->timestamp('reviewedAt')->nullable();
            $table->uuid('reviewedBy')->nullable();
            $table->text('rejectionReason')->nullable();
            $table->timestamp('createdAt')->nullable();
            $table->timestamp('updatedAt')->nullable();
        });
        Schema::create('ServicePackage', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('serviceId');
            $table->string('tier');
            $table->string('name');
            $table->text('description');
            $table->integer('priceCentavos');
            $table->integer('deliveryDays');
            $table->integer('revisionLimit')->default(0);
            $table->boolean('isActive')->default(true);
        });
        Schema::create('ServiceMedia', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('serviceId');
            $table->string('kind');
            $table->string('storagePath')->unique();
            $table->string('originalName');
            $table->string('mimeType');
            $table->integer('sizeBytes');
            $table->integer('sortOrder')->default(0);
            $table->timestamp('createdAt');
        });
        Schema::create('SavedService', function (Blueprint $table): void {
            $table->uuid('userId');
            $table->uuid('serviceId');
            $table->timestamp('createdAt');
            $table->primary(['userId', 'serviceId']);
        });
        Schema::create('Order', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerId');
            $table->string('status');
            $table->string('titleSnapshot')->nullable();
        });
        Schema::create('Review', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('reviewerId');
            $table->uuid('revieweeId');
            $table->integer('overallRating');
            $table->integer('qualityRating')->nullable();
            $table->integer('communicationRating')->nullable();
            $table->integer('timelinessRating')->nullable();
            $table->text('comment')->nullable();
            $table->timestamp('createdAt');
        });
    }

    protected function tearDown(): void
    {
        foreach (['Review', 'Order', 'SavedService', 'ServiceMedia', 'ServicePackage', 'Service', 'SchoolAdminAssignment', 'VerificationRequest', 'StudentProfile', 'ProviderProfile', 'School', 'Category', 'AuthSession', 'UserRoleAssignment', 'User'] as $table) {
            Schema::dropIfExists($table);
        }
        parent::tearDown();
    }

    public function test_public_categories_and_schools_only_include_available_marketplace_data(): void
    {
        DB::table('Category')->insert([
            ['id' => 'design', 'name' => 'Design', 'isActive' => true, 'sortOrder' => 2],
            ['id' => 'code', 'name' => 'Programming', 'isActive' => true, 'sortOrder' => 1],
            ['id' => 'hidden', 'name' => 'Hidden', 'isActive' => false, 'sortOrder' => 0],
        ]);
        $schoolId = (string) Str::uuid();
        DB::table('School')->insert([
            'id' => $schoolId, 'name' => 'Batangas State University', 'shortName' => 'BatStateU', 'city' => 'Lipa City',
            'status' => 'ACTIVE', 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        $providerId = (string) Str::uuid();
        DB::table('ProviderProfile')->insert(['userId' => $providerId, 'isAvailable' => true]);
        DB::table('StudentProfile')->insert(['userId' => $providerId, 'schoolId' => $schoolId]);
        DB::table('Service')->insert(['id' => (string) Str::uuid(), 'providerId' => $providerId, 'categoryId' => 'code', 'status' => 'PUBLISHED']);

        $this->getJson('/api/v1/categories')->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.0.id', 'code')->assertJsonPath('data.0.serviceCount', 1)
            ->assertJsonPath('data.1.id', 'design')->assertJsonPath('data.1.serviceCount', 0)
            ->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/schools')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.shortName', 'BatStateU');
    }

    public function test_school_admin_endpoints_require_admin_role(): void
    {
        $clientToken = $this->tokenFor('CLIENT');
        $this->withToken($clientToken)->getJson('/api/v1/admin/schools')->assertForbidden();

        $adminToken = $this->tokenFor('ADMIN');
        $created = $this->withToken($adminToken)->postJson('/api/v1/admin/schools', [
            'name' => 'Lipa City College', 'shortName' => 'LCC', 'emailDomain' => ' LCC.EDU.PH ',
        ])->assertCreated()->assertJsonPath('emailDomain', 'lcc.edu.ph')->assertJsonPath('status', 'PENDING')->json();
        $this->withToken($adminToken)->patchJson("/api/v1/admin/schools/{$created['id']}/status", ['status' => 'ACTIVE'])
            ->assertOk()->assertJsonPath('status', 'ACTIVE');
    }

    public function test_fixed_price_quote_applies_rush_and_platform_fee_policy(): void
    {
        $schoolId = (string) Str::uuid();
        $providerId = (string) Str::uuid();
        $serviceId = (string) Str::uuid();
        DB::table('School')->insert(['id' => $schoolId, 'name' => 'School', 'shortName' => 'SCH', 'city' => 'Lipa City', 'status' => 'ACTIVE', 'createdAt' => now(), 'updatedAt' => now()]);
        DB::table('ProviderProfile')->insert(['userId' => $providerId, 'isAvailable' => true, 'maxPendingOrders' => 50]);
        DB::table('StudentProfile')->insert(['userId' => $providerId, 'schoolId' => $schoolId]);
        DB::table('Service')->insert([
            'id' => $serviceId, 'providerId' => $providerId, 'categoryId' => 'code', 'status' => 'PUBLISHED',
            'pricingModel' => 'SINGLE_PRICE_V2', 'basePriceCentavos' => 100000, 'normalDeliveryMinutes' => 4320,
            'includedRevisionLimit' => 1, 'acceptsRushOrders' => true, 'fastestRushTier' => 'HOURS_6',
        ]);

        $this->withToken($this->tokenFor('CLIENT'))->postJson("/api/v1/services/{$serviceId}/quote", ['deliveryOption' => 'RUSH_12_HOURS'])
            ->assertOk()->assertJsonPath('data.basePriceCentavos', 100000)
            ->assertJsonPath('data.rushSurchargeCentavos', 30000)
            ->assertJsonPath('data.platformFeeCentavos', 6500)
            ->assertJsonPath('data.clientTotalCentavos', 136500)
            ->assertJsonPath('data.deliveryDurationMinutes', 720)
            ->assertJsonPath('data.eligibleDeliveryOptions.3', 'RUSH_6_HOURS');
    }

    public function test_public_service_discovery_supports_fixed_and_legacy_pricing_filters_and_details(): void
    {
        [$fixedId, $legacyId] = $this->seedMarketplaceServices();

        $this->getJson('/api/v1/services?sort=price-low&maximumDeliveryDays=5')
            ->assertOk()->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('page', 1)->assertJsonPath('pageSize', 20)->assertJsonPath('total', 2)
            ->assertJsonPath('data.0.id', $legacyId)->assertJsonPath('data.0.price', 450)
            ->assertJsonPath('data.0.delivery', '5 days')->assertJsonPath('data.1.id', $fixedId)
            ->assertJsonPath('data.1.delivery', '3 days')->assertJsonPath('hasMore', false);

        $this->getJson('/api/v1/services?query=mobile&budgetRange=500-999&minimumRating=4')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $fixedId)
            ->assertJsonPath('data.0.coverMediaId', fn ($value): bool => is_string($value))
            ->assertJsonCount(1, 'data.0.portfolio');

        $this->getJson("/api/v1/services/{$fixedId}")
            ->assertOk()->assertJsonPath('id', $fixedId)->assertJsonPath('pricingModel', 'SINGLE_PRICE_V2')
            ->assertJsonPath('provider', 'Provider One')->assertJsonPath('school', 'Batangas State University');
    }

    public function test_authenticated_user_can_save_list_and_unsave_available_services(): void
    {
        [$fixedId] = $this->seedMarketplaceServices();
        $token = $this->tokenFor('CLIENT');

        $this->withToken($token)->putJson("/api/v1/services/{$fixedId}/save")
            ->assertOk()->assertJson(['saved' => true]);
        $this->withToken($token)->putJson("/api/v1/services/{$fixedId}/save")
            ->assertOk()->assertJson(['saved' => true]);
        $this->withToken($token)->getJson('/api/v1/services/saved/ids')
            ->assertOk()->assertJsonPath('data.0', $fixedId)->assertJsonCount(1, 'data');
        $this->withToken($token)->getJson('/api/v1/services/saved')
            ->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $fixedId);
        $this->withToken($token)->deleteJson("/api/v1/services/{$fixedId}/save")
            ->assertOk()->assertJson(['saved' => false]);
        $this->withToken($token)->getJson('/api/v1/services/saved/ids')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_public_service_media_is_delivered_from_private_storage(): void
    {
        [$fixedId, , $coverId] = $this->seedMarketplaceServices();
        Storage::fake('campusgig_private');
        Storage::disk('campusgig_private')->put('service-media/cover.jpg', 'image-bytes');

        $response = $this->get("/api/v1/services/{$fixedId}/media/{$coverId}");
        $response->assertOk()->assertHeader('Content-Type', 'image/jpeg')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame('image-bytes', file_get_contents($response->baseResponse->getFile()->getPathname()));
    }

    public function test_public_provider_profile_and_reviews_preserve_privacy_and_pagination_contracts(): void
    {
        [$fixedId, , , $providerId] = $this->seedMarketplaceServices();
        DB::table('UserRoleAssignment')->insert(['userId' => $providerId, 'role' => 'PROVIDER', 'createdAt' => now()]);
        DB::table('ProviderProfile')->where('userId', $providerId)->update([
            'headline' => 'Mobile developer', 'bio' => 'I build production-ready mobile applications.',
            'instagramUrl' => 'https://instagram.com/provider',
        ]);
        $reviewerId = (string) Str::uuid();
        DB::table('User')->insert([
            'id' => $reviewerId, 'email' => 'client-reviewer@example.com', 'passwordHash' => 'unused',
            'displayName' => 'Kevin Buenvenida', 'status' => 'ACTIVE', 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        $orderId = (string) Str::uuid();
        DB::table('Order')->insert([
            'id' => $orderId, 'providerId' => $providerId, 'status' => 'COMPLETED', 'titleSnapshot' => 'Mobile App',
        ]);
        DB::table('Review')->insert([
            'id' => (string) Str::uuid(), 'orderId' => $orderId, 'reviewerId' => $reviewerId, 'revieweeId' => $providerId,
            'overallRating' => 5, 'qualityRating' => 5, 'communicationRating' => 4, 'timelinessRating' => 5,
            'comment' => 'Excellent work', 'createdAt' => now(),
        ]);

        $this->getJson("/api/v1/providers/{$providerId}/public")
            ->assertOk()->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.id', $providerId)->assertJsonPath('data.rating', 5)
            ->assertJsonPath('data.reviewCount', 1)->assertJsonPath('data.completedOrders', 1)
            ->assertJsonPath('data.services.0.id', $fixedId)->assertJsonMissingPath('data.services.0.acceptingOrders')
            ->assertJsonPath('data.socialLinks.instagram', 'https://instagram.com/provider');
        $this->getJson("/api/v1/providers/{$providerId}/reviews?page=99&pageSize=5")
            ->assertOk()->assertJsonPath('data.0.reviewerLabel', 'Kevin B.')
            ->assertJsonPath('summary.average', 5)->assertJsonPath('summary.distribution.0.count', 1)
            ->assertJsonPath('pagination.page', 1)->assertJsonPath('pagination.totalPages', 1);
    }

    public function test_verified_provider_can_manage_profile_availability_and_view_dashboard_services(): void
    {
        $token = $this->tokenFor('PROVIDER');
        $providerId = app(TokenCodec::class)->decode($token)['sub'];
        $schoolId = (string) Str::uuid();
        DB::table('School')->insert([
            'id' => $schoolId, 'name' => 'School', 'shortName' => 'SCH', 'city' => 'Lipa City',
            'status' => 'ACTIVE', 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('StudentProfile')->insert([
            'userId' => $providerId, 'schoolId' => $schoolId, 'program' => 'BSIT',
            'verificationStatus' => 'APPROVED', 'ratingAverage' => 0, 'reviewCount' => 0,
        ]);
        DB::table('Category')->insert(['id' => 'code', 'name' => 'Programming', 'isActive' => true, 'sortOrder' => 1]);

        $this->withToken($token)->putJson('/api/v1/provider/profile', [
            'headline' => 'Mobile developer',
            'bio' => 'I build maintainable production mobile applications.',
            'skills' => [' MAUI ', 'API', 'MAUI'],
            'isAvailable' => true,
            'maxActiveOrders' => 4,
            'maxPendingOrders' => 8,
            'portfolioUrl' => 'https://example.com/portfolio',
        ])->assertOk()->assertJsonPath('data.skills.0', 'MAUI')->assertJsonPath('data.skills.1', 'API')
            ->assertJsonPath('data.maxPendingOrders', 8);

        $service = $this->withToken($token)->postJson('/api/v1/provider/services', [
            'categoryId' => 'code',
            'title' => 'Private mobile draft',
            'description' => 'A sufficiently detailed private listing description for lifecycle testing.',
            'deliveryMethod' => 'ONLINE',
            'pricingModel' => 'SINGLE_PRICE_V2',
            'basePriceCentavos' => 50000,
            'normalDeliveryMinutes' => 1440,
            'includedRevisionLimit' => 1,
            'acceptsRushOrders' => false,
        ])->assertCreated()->assertJsonPath('data.status', 'DRAFT')->json('data');
        $serviceId = $service['id'];
        $this->withToken($token)->putJson("/api/v1/provider/services/{$serviceId}", [
            'categoryId' => 'code',
            'title' => 'Updated mobile draft',
            'description' => 'An updated and sufficiently detailed private listing description for lifecycle testing.',
            'deliveryMethod' => 'HYBRID',
            'pricingModel' => 'SINGLE_PRICE_V2',
            'basePriceCentavos' => 60000,
            'normalDeliveryMinutes' => 2880,
            'includedRevisionLimit' => 2,
            'acceptsRushOrders' => true,
            'fastestRushTier' => 'HOURS_6',
        ])->assertOk()->assertJsonPath('data.basePriceCentavos', 60000);
        Storage::fake('campusgig_private');
        $coverBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
        $media = $this->withToken($token)->post("/api/v1/provider/services/{$serviceId}/media", [
            'cover' => UploadedFile::fake()->createWithContent('cover.png', $coverBytes),
            'portfolio' => [UploadedFile::fake()->createWithContent('brief.pdf', "%PDF-1.4\nCampusGig\n%%EOF")],
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonCount(2, 'data')->json('data');
        $cover = collect($media)->firstWhere('kind', 'COVER');
        $portfolio = collect($media)->firstWhere('kind', 'PORTFOLIO');
        Storage::disk('campusgig_private')->assertExists('service-media/'.$cover['storagePath']);
        $ownedMedia = $this->withToken($token)->get("/api/v1/provider/services/{$serviceId}/media/{$cover['id']}");
        $ownedMedia->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->assertSame($coverBytes, file_get_contents($ownedMedia->baseResponse->getFile()->getPathname()));
        $this->withToken($token)->deleteJson("/api/v1/provider/services/{$serviceId}/media/{$portfolio['id']}")
            ->assertOk()->assertJsonPath('message', 'Service media removed');
        Storage::disk('campusgig_private')->assertMissing('service-media/'.$portfolio['storagePath']);
        $this->withToken($token)->getJson('/api/v1/provider/services')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.category.name', 'Programming')
            ->assertJsonPath('data.0.packages', [])->assertJsonCount(1, 'data.0.media');
        $this->withToken($token)->getJson('/api/v1/provider/dashboard')
            ->assertOk()->assertJsonPath('profileStrength', 67)->assertJsonPath('verified', true)
            ->assertJsonPath('acceptingOrders', true);
        $this->withToken($token)->putJson('/api/v1/provider/availability', ['isAvailable' => false])
            ->assertOk()->assertJsonPath('data.isAvailable', false)
            ->assertJsonPath('message', 'You are offline and your services are paused');
        $this->withToken($token)->postJson("/api/v1/provider/services/{$serviceId}/submit")
            ->assertOk()->assertJsonPath('data.status', 'PENDING_REVIEW');
        $this->withToken($token)->putJson("/api/v1/provider/services/{$serviceId}", [
            'categoryId' => 'code', 'title' => 'Cannot edit now',
            'description' => 'This valid payload must still be rejected because the state is pending review.',
            'deliveryMethod' => 'ONLINE', 'pricingModel' => 'SINGLE_PRICE_V2',
            'basePriceCentavos' => 60000, 'normalDeliveryMinutes' => 2880,
            'includedRevisionLimit' => 2, 'acceptsRushOrders' => false,
        ])->assertConflict();

        DB::table('Service')->where('id', $serviceId)->update(['status' => 'PUBLISHED', 'publishedAt' => now()]);
        $this->withToken($token)->postJson("/api/v1/provider/services/{$serviceId}/pause")
            ->assertOk()->assertJsonPath('data.status', 'PAUSED');
        $this->withToken($token)->postJson("/api/v1/provider/services/{$serviceId}/resume")
            ->assertOk()->assertJsonPath('data.status', 'PUBLISHED');
        $this->withToken($token)->postJson("/api/v1/provider/services/{$serviceId}/archive")
            ->assertOk()->assertJsonPath('data.status', 'ARCHIVED');
        $this->withToken($token)->postJson("/api/v1/provider/services/{$serviceId}/restore")
            ->assertOk()->assertJsonPath('data.status', 'PAUSED');
        $this->withToken($token)->postJson("/api/v1/provider/services/{$serviceId}/revise")
            ->assertOk()->assertJsonPath('data.status', 'DRAFT');
    }

    public function test_student_profile_verification_and_admin_moderation_contracts_are_role_scoped(): void
    {
        Storage::fake('campusgig_private');
        $schoolId = (string) Str::uuid();
        $otherSchoolId = (string) Str::uuid();
        DB::table('School')->insert([
            ['id' => $schoolId, 'name' => 'CampusGig University', 'shortName' => 'CGU', 'city' => 'Lipa City', 'status' => 'ACTIVE', 'createdAt' => now(), 'updatedAt' => now()],
            ['id' => $otherSchoolId, 'name' => 'Other University', 'shortName' => 'OU', 'city' => 'Lipa City', 'status' => 'ACTIVE', 'createdAt' => now(), 'updatedAt' => now()],
        ]);
        [$student, $studentToken] = $this->userWithRoles('profile-student@example.com', ['CLIENT', 'STUDENT']);
        [, $adminToken] = $this->userWithRoles('profile-admin@example.com', ['ADMIN']);
        [$schoolAdmin, $schoolAdminToken] = $this->userWithRoles('school-admin@example.com', ['SCHOOL_ADMIN']);
        [$candidate] = $this->userWithRoles('candidate-admin@example.com', ['CLIENT']);
        DB::table('SchoolAdminAssignment')->insert(['userId' => $schoolAdmin->id, 'schoolId' => $schoolId, 'createdAt' => now()]);

        $this->withToken($studentToken)->putJson('/api/v1/profile/student', [
            'schoolId' => $schoolId, 'program' => ' BS Information Technology ',
            'yearLevel' => 3, 'bio' => 'Student developer focused on mobile and web applications.',
        ])->assertOk()->assertJsonPath('data.program', 'BS Information Technology')
            ->assertJsonPath('data.school.shortName', 'CGU')->assertJsonPath('data.verificationStatus', 'UNSUBMITTED');
        $this->withToken($studentToken)->getJson('/api/v1/profile/student')->assertOk()
            ->assertJsonPath('data.yearLevel', 3)->assertJsonPath('data.completedOrderCount', 0);

        $avatarBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
        $this->withToken($studentToken)->post('/api/v1/profile/avatar', [
            'avatar' => UploadedFile::fake()->createWithContent('avatar.png', $avatarBytes),
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.hasAvatar', true);
        $avatarPath = DB::table('User')->where('id', $student->id)->value('avatarPath');
        Storage::disk('campusgig_private')->assertExists('avatars/'.$avatarPath);
        $this->get("/api/v1/profile/avatar/{$student->id}")->assertOk();

        $verificationId = $this->withToken($studentToken)->post('/api/v1/profile/student/verification', [
            'studentId' => UploadedFile::fake()->createWithContent('student-id.pdf', "%PDF-1.4\nStudent ID\n%%EOF"),
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonPath('data.status', 'PENDING')->json('data.id');
        $this->withToken($studentToken)->getJson('/api/v1/profile/student/verification')->assertOk()
            ->assertJsonPath('data.id', $verificationId)->assertJsonPath('data.reviewedAt', null);
        $this->withToken($studentToken)->post('/api/v1/profile/student/verification', [
            'studentId' => UploadedFile::fake()->createWithContent('duplicate.pdf', "%PDF-1.4\nDuplicate\n%%EOF"),
        ], ['Accept' => 'application/json'])->assertConflict();

        $this->withToken($schoolAdminToken)->getJson('/api/v1/admin/verifications')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $verificationId)
            ->assertJsonPath('data.0.schoolShortName', 'CGU');
        $this->withToken($schoolAdminToken)->get("/api/v1/admin/verifications/{$verificationId}/document")
            ->assertOk()->assertDownload('Student ID');
        $this->withToken($schoolAdminToken)->postJson("/api/v1/admin/verifications/{$verificationId}/approve")
            ->assertOk()->assertJsonPath('data.status', 'APPROVED');
        $this->assertDatabaseHas('UserRoleAssignment', ['userId' => $student->id, 'role' => 'PROVIDER']);
        $this->assertSame('APPROVED', DB::table('StudentProfile')->where('userId', $student->id)->value('verificationStatus'));

        DB::table('Category')->insert(['id' => 'admin-code', 'name' => 'Programming', 'isActive' => true, 'sortOrder' => 1]);
        $approvedServiceId = (string) Str::uuid();
        $rejectedServiceId = (string) Str::uuid();
        foreach ([$approvedServiceId, $rejectedServiceId] as $index => $serviceId) {
            DB::table('Service')->insert([
                'id' => $serviceId, 'providerId' => $student->id, 'categoryId' => 'admin-code',
                'title' => $index === 0 ? 'Approved mobile service' : 'Rejected mobile service',
                'slug' => 'admin-service-'.$index, 'description' => 'A complete service description for moderation.',
                'status' => 'PENDING_REVIEW', 'pricingModel' => 'SINGLE_PRICE_V2',
                'basePriceCentavos' => 50000, 'normalDeliveryMinutes' => 2880,
                'includedRevisionLimit' => 1, 'acceptsRushOrders' => false,
                'createdAt' => now(), 'updatedAt' => now()->addSeconds($index),
            ]);
        }
        $this->withToken($adminToken)->getJson('/api/v1/admin/services?limit=1')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('pagination.hasMore', true)
            ->assertJsonPath('data.0.provider.email', $student->email);
        $this->withToken($adminToken)->postJson("/api/v1/admin/services/{$approvedServiceId}/approve")
            ->assertOk()->assertJsonPath('data.status', 'PUBLISHED');
        $this->withToken($adminToken)->postJson("/api/v1/admin/services/{$rejectedServiceId}/reject", [
            'reason' => 'The listing requires clearer scope and deliverables.',
        ])->assertOk()->assertJsonPath('data.status', 'REJECTED');
        $this->withToken($schoolAdminToken)->postJson("/api/v1/admin/services/{$approvedServiceId}/approve")->assertForbidden();

        $this->withToken($adminToken)->getJson('/api/v1/admin/dashboard')->assertOk()
            ->assertJsonPath('registeredStudents', 1)->assertJsonPath('activeServices', 1)
            ->assertJsonPath('pendingVerifications', 0);
        $this->withToken($adminToken)->postJson('/api/v1/admin/school-admins', [
            'email' => strtoupper($candidate->email), 'schoolId' => $otherSchoolId,
        ])->assertOk()->assertJsonPath('school.shortName', 'OU')
            ->assertJsonPath('user.email', $candidate->email);
        $this->withToken($adminToken)->getJson('/api/v1/admin/school-admins')->assertOk()->assertJsonCount(2, 'data');
        $this->withToken($adminToken)->deleteJson("/api/v1/admin/school-admins/{$candidate->id}")
            ->assertOk()->assertJsonPath('message', 'School administrator access removed');
        $this->assertDatabaseMissing('UserRoleAssignment', ['userId' => $candidate->id, 'role' => 'SCHOOL_ADMIN']);
    }

    private function seedMarketplaceServices(): array
    {
        $schoolId = (string) Str::uuid();
        $providerId = (string) Str::uuid();
        $fixedId = (string) Str::uuid();
        $legacyId = (string) Str::uuid();
        $coverId = (string) Str::uuid();
        $now = now();
        DB::table('Category')->insert(['id' => 'code', 'name' => 'Programming', 'isActive' => true, 'sortOrder' => 1]);
        DB::table('School')->insert(['id' => $schoolId, 'name' => 'Batangas State University', 'shortName' => 'BatStateU', 'city' => 'Lipa City', 'status' => 'ACTIVE', 'createdAt' => $now, 'updatedAt' => $now]);
        DB::table('User')->insert([
            'id' => $providerId, 'email' => 'provider@example.com', 'passwordHash' => 'unused', 'displayName' => 'Provider One',
            'status' => 'ACTIVE', 'createdAt' => $now, 'updatedAt' => $now,
        ]);
        DB::table('ProviderProfile')->insert(['userId' => $providerId, 'skills' => json_encode(['Mobile Development']), 'isAvailable' => true, 'maxPendingOrders' => 2]);
        DB::table('StudentProfile')->insert(['userId' => $providerId, 'schoolId' => $schoolId, 'program' => 'BSIT', 'verificationStatus' => 'APPROVED', 'ratingAverage' => 4.75, 'reviewCount' => 8]);
        DB::table('Service')->insert([
            [
                'id' => $fixedId, 'providerId' => $providerId, 'categoryId' => 'code', 'title' => 'Mobile App', 'description' => 'Production mobile development',
                'status' => 'PUBLISHED', 'publishedAt' => $now, 'pricingModel' => 'SINGLE_PRICE_V2', 'basePriceCentavos' => 74700,
                'normalDeliveryMinutes' => 4320, 'includedRevisionLimit' => 1, 'acceptsRushOrders' => true, 'fastestRushTier' => 'HOURS_6',
            ],
            [
                'id' => $legacyId, 'providerId' => $providerId, 'categoryId' => 'code', 'title' => 'Legacy Design', 'description' => 'Existing package listing',
                'status' => 'PUBLISHED', 'publishedAt' => $now->copy()->subMinute(), 'pricingModel' => 'LEGACY_PACKAGES',
                'basePriceCentavos' => null, 'normalDeliveryMinutes' => null, 'includedRevisionLimit' => null,
                'acceptsRushOrders' => false, 'fastestRushTier' => null,
            ],
        ]);
        DB::table('ServicePackage')->insert([
            ['id' => (string) Str::uuid(), 'serviceId' => $legacyId, 'tier' => 'BASIC', 'name' => 'Basic', 'description' => 'Basic package', 'priceCentavos' => 45000, 'deliveryDays' => 5, 'revisionLimit' => 1, 'isActive' => true],
            ['id' => (string) Str::uuid(), 'serviceId' => $legacyId, 'tier' => 'STANDARD', 'name' => 'Standard', 'description' => 'Standard package', 'priceCentavos' => 70000, 'deliveryDays' => 2, 'revisionLimit' => 2, 'isActive' => true],
        ]);
        DB::table('ServiceMedia')->insert([
            ['id' => $coverId, 'serviceId' => $fixedId, 'kind' => 'COVER', 'storagePath' => 'cover.jpg', 'originalName' => 'cover.jpg', 'mimeType' => 'image/jpeg', 'sizeBytes' => 11, 'sortOrder' => 0, 'createdAt' => $now],
            ['id' => (string) Str::uuid(), 'serviceId' => $fixedId, 'kind' => 'PORTFOLIO', 'storagePath' => 'sample.png', 'originalName' => 'sample.png', 'mimeType' => 'image/png', 'sizeBytes' => 20, 'sortOrder' => 0, 'createdAt' => $now],
        ]);

        return [$fixedId, $legacyId, $coverId, $providerId];
    }

    private function tokenFor(string $role): string
    {
        return $this->userWithRoles(strtolower($role).'@example.com', [$role])[1];
    }

    private function userWithRoles(string $email, array $roles): array
    {
        $user = User::query()->create([
            'email' => $email, 'displayName' => $roles[0], 'passwordHash' => 'unused',
            'status' => 'ACTIVE', 'emailVerifiedAt' => now(),
            'mfaEnabledAt' => array_intersect(['ADMIN', 'SCHOOL_ADMIN'], $roles) !== [] ? now() : null,
            'sessionVersion' => 0,
        ]);
        foreach ($roles as $role) {
            UserRoleAssignment::query()->create(['userId' => $user->id, 'role' => $role]);
        }
        $session = AuthSession::query()->create([
            'id' => (string) Str::uuid(), 'userId' => $user->id, 'clientType' => 'WEB', 'deviceName' => 'Test',
            'sessionVersion' => 0, 'expiresAt' => now()->addDay(), 'lastUsedAt' => now(),
        ]);

        $token = app(TokenCodec::class)->issue(['sub' => $user->id, 'email' => $user->email, 'roles' => $roles, 'sessionVersion' => 0, 'sid' => $session->id]);

        return [$user, $token];
    }
}
