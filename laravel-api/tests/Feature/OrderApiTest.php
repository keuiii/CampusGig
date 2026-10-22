<?php

namespace Tests\Feature;

use App\Models\AuthSession;
use App\Models\User;
use App\Models\UserRoleAssignment;
use App\Services\Auth\TokenCodec;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

final class OrderApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['campusgig.jwt_secret' => 'test-only-secret-with-at-least-thirty-two-characters']);

        Schema::create('User', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('email')->unique();
            $table->string('passwordHash');
            $table->string('displayName');
            $table->string('avatarPath')->nullable();
            $table->string('status')->default('ACTIVE');
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
        Schema::create('ProviderProfile', function (Blueprint $table): void {
            $table->uuid('userId')->primary();
            $table->boolean('isAvailable')->default(true);
            $table->integer('maxActiveOrders')->default(5);
            $table->integer('maxPendingOrders')->default(50);
        });
        Schema::create('StudentProfile', function (Blueprint $table): void {
            $table->uuid('userId')->primary();
            $table->decimal('ratingAverage', 3, 2)->default(0);
            $table->integer('reviewCount')->default(0);
            $table->integer('completedOrderCount')->default(0);
        });
        Schema::create('Service', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerId');
            $table->string('title');
            $table->string('status');
            $table->timestamp('deletedAt')->nullable();
            $table->string('pricingModel');
            $table->integer('basePriceCentavos')->nullable();
            $table->integer('normalDeliveryMinutes')->nullable();
            $table->integer('includedRevisionLimit')->nullable();
            $table->boolean('acceptsRushOrders')->default(false);
            $table->string('fastestRushTier')->nullable();
        });
        Schema::create('ServicePackage', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('serviceId');
            $table->string('tier');
            $table->string('name');
            $table->text('description');
            $table->integer('priceCentavos');
            $table->integer('deliveryDays');
            $table->integer('revisionLimit');
            $table->boolean('isActive')->default(true);
        });
        Schema::create('Order', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('orderNumber')->unique();
            $table->uuid('clientRequestId')->nullable();
            $table->string('requestFingerprint')->nullable();
            $table->uuid('clientId');
            $table->uuid('providerId');
            $table->uuid('serviceId');
            $table->uuid('servicePackageId')->nullable();
            $table->string('pricingModel')->default('LEGACY_PACKAGE_V1');
            $table->string('titleSnapshot');
            $table->json('packageSnapshot')->nullable();
            $table->json('termsSnapshot');
            $table->integer('basePriceCentavos')->nullable();
            $table->integer('rushSurchargeCentavos')->nullable();
            $table->string('deliveryOption')->nullable();
            $table->integer('deliveryDurationMinutes')->nullable();
            $table->integer('pricingPolicyVersion')->nullable();
            $table->integer('platformFeeBasisPoints')->nullable();
            $table->integer('rushBasisPoints')->nullable();
            $table->integer('subtotalCentavos');
            $table->integer('platformFeeCentavos')->default(0);
            $table->integer('totalCentavos');
            $table->string('currency')->default('PHP');
            $table->text('requirements');
            $table->timestamp('dueAt')->nullable();
            $table->string('status')->default('REQUESTED');
            $table->integer('revisionLimit')->default(0);
            $table->integer('revisionsUsed')->default(0);
            $table->timestamp('acceptedAt')->nullable();
            $table->timestamp('startedAt')->nullable();
            $table->timestamp('submittedAt')->nullable();
            $table->timestamp('completedAt')->nullable();
            $table->string('completionSource')->nullable();
            $table->integer('reviewPolicyVersion')->nullable();
            $table->timestamp('reviewStartedAt')->nullable();
            $table->timestamp('reviewDeadlineAt')->nullable();
            $table->uuid('reviewDeliverySubmissionId')->nullable();
            $table->timestamp('clientArchivedAt')->nullable();
            $table->timestamp('clientRemovedAt')->nullable();
            $table->timestamp('providerArchivedAt')->nullable();
            $table->timestamp('providerRemovedAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
            $table->unique(['clientId', 'clientRequestId']);
        });
        Schema::create('OrderStatusHistory', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->string('fromStatus')->nullable();
            $table->string('toStatus');
            $table->uuid('changedBy')->nullable();
            $table->text('note')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('Conversation', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('kind');
            $table->uuid('orderId')->nullable()->unique();
            $table->uuid('clientId')->nullable();
            $table->uuid('providerId')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('ConversationParticipant', function (Blueprint $table): void {
            $table->uuid('conversationId');
            $table->uuid('userId');
            $table->uuid('lastReadMessageId')->nullable();
            $table->timestamp('lastReadAt')->nullable();
            $table->timestamp('hiddenAt')->nullable();
            $table->timestamp('pinnedAt')->nullable();
            $table->timestamp('archivedAt')->nullable();
            $table->primary(['conversationId', 'userId']);
        });
        Schema::create('Message', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('conversationId');
            $table->uuid('senderId');
            $table->text('body')->nullable();
            $table->string('messageType')->default('TEXT');
            $table->uuid('replyToId')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('editedAt')->nullable();
            $table->timestamp('deletedAt')->nullable();
        });
        Schema::create('MessageAttachment', function (Blueprint $table): void {
            $table->uuid('messageId');
            $table->uuid('orderFileId');
            $table->primary(['messageId', 'orderFileId']);
        });
        Schema::create('Notification', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('recipientId');
            $table->uuid('orderId')->nullable();
            $table->uuid('conversationId')->nullable();
            $table->string('type');
            $table->string('title');
            $table->text('body');
            $table->timestamp('readAt')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('SupportTicket', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('userId');
            $table->string('category');
            $table->string('subject');
            $table->text('message');
            $table->string('source');
            $table->string('status')->default('OPEN');
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
            $table->timestamp('resolvedAt')->nullable();
        });
        Schema::create('Payment', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->string('provider')->default('PAYMONGO');
            $table->string('providerPaymentId')->nullable()->unique();
            $table->string('providerCheckoutId')->nullable()->unique();
            $table->text('checkoutUrl')->nullable();
            $table->string('idempotencyKey')->nullable()->unique();
            $table->integer('amountCentavos')->default(1);
            $table->integer('platformFeeCentavos')->default(0);
            $table->integer('providerNetCentavos')->default(1);
            $table->string('status');
            $table->integer('refundedCentavos')->default(0);
            $table->string('currency')->default('PHP');
            $table->string('failureCode')->nullable();
            $table->timestamp('paidAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt')->nullable();
        });
        Schema::create('PaymentRefund', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId')->nullable();
            $table->uuid('paymentId')->nullable();
            $table->uuid('revisionPurchaseId')->nullable();
            $table->uuid('providerEarningId')->nullable();
            $table->uuid('triggeringDisputeId')->nullable();
            $table->uuid('requestedById')->nullable();
            $table->string('sourceType')->nullable();
            $table->string('reasonCode')->nullable();
            $table->string('requestOrigin')->nullable();
            $table->string('preRefundEarningStatus')->nullable();
            $table->string('sourceKey')->nullable()->unique();
            $table->string('providerRefundId')->nullable()->unique();
            $table->string('idempotencyKey')->unique();
            $table->integer('providerPrincipalCentavos')->nullable();
            $table->integer('platformFeeCentavos')->nullable();
            $table->integer('refundTotalCentavos')->nullable();
            $table->integer('amountCentavos');
            $table->string('currency')->nullable();
            $table->string('reason');
            $table->string('status')->default('REQUESTED');
            $table->string('providerStatus')->nullable();
            $table->string('failureCode')->nullable();
            $table->timestamp('requestedAt');
            $table->timestamp('submittedAt')->nullable();
            $table->timestamp('processedAt')->nullable();
            $table->timestamp('reconciliationRequiredAt')->nullable();
            $table->timestamp('accountingReversedAt')->nullable();
            $table->integer('providerPrincipalReversedCentavos')->default(0);
            $table->integer('platformFeeReversedCentavos')->default(0);
            $table->timestamp('providerCreatedAt')->nullable();
            $table->timestamp('providerUpdatedAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
        });
        Schema::create('PlatformFeeLedgerEntry', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('refundId')->unique();
            $table->string('type');
            $table->integer('amountCentavos');
            $table->string('currency');
            $table->string('sourceKey')->unique();
            $table->timestamp('createdAt');
        });
        Schema::create('DeliverySubmission', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('providerId');
            $table->integer('version');
            $table->text('note')->nullable();
            $table->uuid('clientRequestId')->nullable();
            $table->string('requestFingerprint')->nullable();
            $table->uuid('revisionRequestId')->nullable()->unique();
            $table->timestamp('submittedAt');
            $table->timestamp('createdAt');
            $table->unique(['orderId', 'version']);
            $table->unique(['orderId', 'clientRequestId']);
        });
        Schema::create('OrderFile', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('deliverySubmissionId')->nullable();
            $table->uuid('uploadedBy');
            $table->string('purpose');
            $table->string('storagePath')->unique();
            $table->string('originalName');
            $table->string('mimeType');
            $table->integer('sizeBytes');
            $table->string('checksum')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('DeliveryFileAccessAudit', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('deliverySubmissionId');
            $table->uuid('fileId');
            $table->uuid('userId');
            $table->string('accessType');
            $table->timestamp('accessedAt');
        });
        Schema::create('RevisionRequest', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('requestedBy');
            $table->integer('sequenceNumber');
            $table->string('type')->nullable();
            $table->text('instructions');
            $table->string('status')->default('OPEN');
            $table->uuid('sourceDeliverySubmissionId')->nullable();
            $table->timestamp('revisionDeadlineAt')->nullable();
            $table->integer('turnaroundMinutes')->nullable();
            $table->timestamp('providerAcknowledgedAt')->nullable();
            $table->timestamp('declinedAt')->nullable();
            $table->timestamp('resolvedAt')->nullable();
            $table->timestamp('createdAt');
            $table->unique(['orderId', 'sequenceNumber']);
        });
        Schema::create('OrderRevisionPurchase', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('sourceDeliverySubmissionId');
            $table->uuid('clientId');
            $table->uuid('providerId');
            $table->uuid('revisionRequestId')->nullable()->unique();
            $table->text('instructions');
            $table->integer('providerSubtotalCentavos');
            $table->integer('platformFeeCentavos');
            $table->integer('totalCentavos');
            $table->string('currency');
            $table->integer('turnaroundMinutes');
            $table->integer('pricingPolicyVersion');
            $table->integer('pricingBasisCentavos');
            $table->integer('deliveryDurationBasisMinutes');
            $table->string('providerPaymentId')->nullable()->unique();
            $table->string('providerCheckoutId')->nullable()->unique();
            $table->text('checkoutUrl')->nullable();
            $table->string('idempotencyKey')->unique();
            $table->string('paymentStatus')->default('PENDING');
            $table->string('activationStatus')->default('PENDING');
            $table->string('failureCode')->nullable();
            $table->timestamp('paidAt')->nullable();
            $table->timestamp('activatedAt')->nullable();
            $table->integer('refundedCentavos')->default(0);
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
        });
        Schema::create('OrderDispute', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId');
            $table->uuid('openedById');
            $table->string('reason');
            $table->text('details');
            $table->string('status');
            $table->uuid('targetDeliverySubmissionId')->nullable();
            $table->uuid('targetRevisionRequestId')->nullable();
            $table->uuid('targetRevisionPurchaseId')->nullable();
            $table->string('responseRequestedFrom')->nullable();
            $table->timestamp('responseRequestedAt')->nullable();
            $table->timestamp('responseDeadlineAt')->nullable();
            $table->integer('responseRequestSequence')->default(0);
            $table->timestamp('reviewPausedAt')->nullable();
            $table->integer('reviewRemainingSeconds')->nullable();
            $table->timestamp('readyForReviewAt')->nullable();
            $table->timestamp('reviewStartedAt')->nullable();
            $table->text('resolutionNote')->nullable();
            $table->uuid('resolvedById')->nullable();
            $table->timestamp('resolvedAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
        });
        Schema::create('DisputeAffectedEarning', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('disputeId');
            $table->uuid('providerEarningId');
            $table->string('preFreezeStatus');
            $table->timestamp('frozenAt');
            $table->timestamp('restoredAt')->nullable();
            $table->timestamp('createdAt');
            $table->unique(['disputeId', 'providerEarningId']);
        });
        Schema::create('DisputeResponse', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('disputeId');
            $table->uuid('responderId');
            $table->string('requestedFrom');
            $table->integer('requestSequence');
            $table->text('details');
            $table->timestamp('responseRequestedAt');
            $table->timestamp('responseDeadlineAt');
            $table->timestamp('createdAt');
            $table->unique(['disputeId', 'requestSequence']);
        });
        Schema::create('DisputeEvidence', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('disputeId');
            $table->uuid('responseId')->nullable();
            $table->uuid('submittedById');
            $table->string('storagePath')->unique();
            $table->string('originalName');
            $table->string('mimeType');
            $table->integer('sizeBytes');
            $table->string('checksum');
            $table->timestamp('createdAt');
        });
        Schema::create('DisputeTimelineEvent', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('disputeId');
            $table->uuid('actorId')->nullable();
            $table->string('type');
            $table->text('details')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('PaymentWebhookEvent', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('provider')->default('PAYMONGO');
            $table->string('providerEventId');
            $table->string('eventType');
            $table->json('payload');
            $table->timestamp('processedAt')->nullable();
            $table->text('processingError')->nullable();
            $table->timestamp('createdAt');
            $table->unique(['provider', 'providerEventId']);
        });
        Schema::create('ProviderEarning', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerId');
            $table->uuid('orderId');
            $table->uuid('paymentId')->nullable()->unique();
            $table->uuid('revisionPurchaseId')->nullable()->unique();
            $table->string('sourceType');
            $table->string('currency');
            $table->integer('grossServiceAmountCentavos');
            $table->string('status');
            $table->timestamp('pendingAt');
            $table->timestamp('availableAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
        });
        Schema::create('ProviderEarningLedgerEntry', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerEarningId');
            $table->uuid('providerId');
            $table->uuid('orderId');
            $table->uuid('sourcePaymentId')->nullable()->unique();
            $table->uuid('sourceRevisionPurchaseId')->nullable()->unique();
            $table->string('type');
            $table->integer('amountCentavos');
            $table->string('currency');
            $table->string('sourceKey')->unique();
            $table->timestamp('createdAt');
        });
        Schema::create('ProviderPayoutDestination', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerId');
            $table->string('type');
            $table->string('displayLabel');
            $table->string('maskedAccountIdentifier');
            $table->string('accountHolderName');
            $table->string('providerAdapterKey')->nullable();
            $table->string('externalReferenceToken')->nullable();
            $table->string('verificationStatus')->default('UNVERIFIED');
            $table->uuid('reviewedById')->nullable();
            $table->timestamp('reviewedAt')->nullable();
            $table->string('reviewNote')->nullable();
            $table->boolean('isActive')->default(true);
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
        });
        Schema::create('ProviderPayout', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('providerId');
            $table->uuid('destinationId');
            $table->uuid('clientRequestId');
            $table->string('sourceKey')->unique();
            $table->string('currency');
            $table->integer('requestedPrincipalCentavos');
            $table->integer('eligiblePrincipalCentavos');
            $table->integer('payoutFeeCentavos')->default(0);
            $table->integer('netDisbursementCentavos');
            $table->string('status')->default('REQUESTED');
            $table->json('destinationSnapshot');
            $table->string('settlementMethod')->nullable();
            $table->string('providerAdapterKey')->nullable();
            $table->string('externalPayoutId')->nullable()->unique();
            $table->string('externalStatus')->nullable();
            $table->string('failureCode')->nullable();
            $table->string('reconciliationContext')->nullable();
            $table->uuid('approvedById')->nullable();
            $table->uuid('settledById')->nullable();
            $table->string('manualSettlementReference')->nullable()->unique();
            $table->string('settlementNote')->nullable();
            $table->timestamp('settlementAt')->nullable();
            $table->timestamp('requestedAt');
            $table->timestamp('approvedAt')->nullable();
            $table->timestamp('processingAt')->nullable();
            $table->timestamp('paidAt')->nullable();
            $table->timestamp('failedAt')->nullable();
            $table->timestamp('rejectedAt')->nullable();
            $table->timestamp('cancelledAt')->nullable();
            $table->timestamp('reconciliationRequiredAt')->nullable();
            $table->timestamp('createdAt');
            $table->timestamp('updatedAt');
            $table->unique(['providerId', 'clientRequestId']);
        });
        Schema::create('ProviderPayoutItem', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('payoutId');
            $table->uuid('providerEarningId');
            $table->integer('principalCentavos');
            $table->string('currency');
            $table->boolean('reservationActive')->default(true);
            $table->timestamp('createdAt');
            $table->unique(['payoutId', 'providerEarningId']);
        });
        Schema::create('ProviderPayoutAudit', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('payoutId');
            $table->uuid('actorId')->nullable();
            $table->string('action');
            $table->json('context')->nullable();
            $table->timestamp('createdAt');
        });
        Schema::create('Review', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('orderId')->unique();
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
        foreach (['Review', 'ProviderPayoutAudit', 'ProviderPayoutItem', 'ProviderPayout', 'ProviderPayoutDestination', 'PlatformFeeLedgerEntry', 'ProviderEarningLedgerEntry', 'DisputeTimelineEvent', 'DisputeEvidence', 'DisputeResponse', 'DisputeAffectedEarning', 'ProviderEarning', 'PaymentWebhookEvent', 'OrderDispute', 'OrderRevisionPurchase', 'RevisionRequest', 'DeliveryFileAccessAudit', 'MessageAttachment', 'Message', 'OrderFile', 'DeliverySubmission', 'PaymentRefund', 'Payment', 'SupportTicket', 'Notification', 'ConversationParticipant', 'Conversation', 'OrderStatusHistory', 'Order', 'ServicePackage', 'Service', 'StudentProfile', 'ProviderProfile', 'AuthSession', 'UserRoleAssignment', 'User'] as $table) {
            Schema::dropIfExists($table);
        }
        parent::tearDown();
    }

    public function test_fixed_price_order_creation_is_idempotent_and_participant_scoped(): void
    {
        [$client, $clientToken] = $this->user('client@example.com', 'Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('provider@example.com', 'Provider', ['PROVIDER']);
        [, $outsiderToken] = $this->user('outsider@example.com', 'Outsider', ['CLIENT']);
        $serviceId = $this->fixedService($provider->id);
        $requestId = (string) Str::uuid();
        $payload = [
            'clientRequestId' => $requestId,
            'serviceId' => $serviceId,
            'deliveryOption' => 'RUSH_12_HOURS',
            'requirements' => 'Build a production-ready mobile application.',
        ];

        $created = $this->withToken($clientToken)->postJson('/api/v1/orders', $payload)
            ->assertCreated()->assertJsonPath('data.pricingModel', 'SINGLE_PRICE_V2')
            ->assertJsonPath('data.subtotalCentavos', 130000)
            ->assertJsonPath('data.platformFeeCentavos', 6500)
            ->assertJsonPath('data.totalCentavos', 136500)
            ->assertJsonPath('data.status', 'REQUESTED')->json('data');
        $orderId = $created['id'];
        $this->withToken($clientToken)->postJson('/api/v1/orders', $payload)
            ->assertCreated()->assertJsonPath('data.id', $orderId)
            ->assertJsonPath('message', 'This service request was already received.');
        $this->assertSame(1, DB::table('Order')->count());
        $this->assertSame(2, DB::table('ConversationParticipant')->count());

        $this->withToken($clientToken)->getJson('/api/v1/orders?scope=client')
            ->assertOk()->assertJsonPath('data.0.id', $orderId)->assertJsonPath('pagination.hasMore', false);
        $this->withToken($providerToken)->getJson('/api/v1/orders?scope=provider')
            ->assertOk()->assertJsonPath('data.0.id', $orderId);
        $this->withToken($clientToken)->getJson("/api/v1/orders/{$orderId}")
            ->assertOk()->assertJsonPath('data.history.0.toStatus', 'REQUESTED');
        $this->withToken($outsiderToken)->getJson("/api/v1/orders/{$orderId}")->assertNotFound();
    }

    public function test_provider_accept_and_start_require_confirmed_payment(): void
    {
        [$client, $clientToken] = $this->user('client2@example.com', 'Client Two', ['CLIENT']);
        [$provider, $providerToken] = $this->user('provider2@example.com', 'Provider Two', ['PROVIDER']);
        $serviceId = $this->fixedService($provider->id);
        $orderId = $this->withToken($clientToken)->postJson('/api/v1/orders', [
            'serviceId' => $serviceId, 'deliveryOption' => 'NORMAL',
            'requirements' => 'Create a complete web and mobile design system.',
        ])->assertCreated()->json('data.id');

        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")
            ->assertOk()->assertJsonPath('data.status', 'ACCEPTED');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/start")
            ->assertConflict()->assertJsonPath('message', 'Wait for the client payment to be confirmed before starting work');
        DB::table('Payment')->insert([
            'id' => (string) Str::uuid(), 'orderId' => $orderId, 'status' => 'PAID', 'paidAt' => now(), 'createdAt' => now(),
        ]);
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/start")
            ->assertOk()->assertJsonPath('data.status', 'IN_PROGRESS')->assertJsonPath('data.paymentStatus', 'PAID');
    }

    public function test_order_messaging_inbox_preferences_and_private_attachments_are_participant_scoped(): void
    {
        Storage::fake('campusgig_private');
        [$client, $clientToken] = $this->user('message-client@example.com', 'Message Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('message-provider@example.com', 'Message Provider', ['PROVIDER']);
        [, $outsiderToken] = $this->user('message-outsider@example.com', 'Message Outsider', ['CLIENT']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Create a secure order conversation.');
        $conversationId = DB::table('Conversation')->where('orderId', $orderId)->value('id');

        $this->withToken($outsiderToken)->getJson("/api/v1/orders/{$orderId}/messages")->assertNotFound();
        $messageId = $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/messages", [
            'body' => 'Please confirm the delivery requirements.',
        ])->assertOk()->assertJsonPath('data.isMine', true)
            ->assertJsonPath('data.sender.displayName', 'Message Client')->json('data.id');
        $this->assertSame(1, DB::table('Notification')->where('recipientId', $provider->id)->where('type', 'NEW_MESSAGE')->count());

        $this->withToken($providerToken)->getJson('/api/v1/conversations')
            ->assertOk()->assertJsonPath('unreadCount', 1)
            ->assertJsonPath('data.0.id', $conversationId)
            ->assertJsonPath('data.0.latestMessage.id', $messageId);
        $this->withToken($providerToken)->getJson("/api/v1/conversations/{$conversationId}/messages")
            ->assertOk()->assertJsonPath('data.0.id', $messageId)
            ->assertJsonPath('data.0.isMine', false);
        $this->assertNotNull(DB::table('Notification')->where('recipientId', $provider->id)
            ->where('type', 'NEW_MESSAGE')->value('readAt'));

        $this->withToken($providerToken)->postJson("/api/v1/conversations/{$conversationId}/messages", [
            'body' => 'Requirements confirmed. I will proceed.',
        ])->assertOk()->assertJsonPath('data.isMine', true);
        $attachment = $this->withToken($clientToken)->post("/api/v1/orders/{$orderId}/messages/attachments", [
            'body' => 'Reference document attached.', 'files' => [$this->pdf('reference.pdf', 'message reference')],
        ])->assertOk()->assertJsonPath('data.messageType', 'FILE')
            ->assertJsonPath('data.attachments.0.originalName', 'reference.pdf')->json('data.attachments.0');
        $this->withToken($providerToken)->get("/api/v1/orders/{$orderId}/files/{$attachment['id']}")->assertOk();

        $this->withToken($clientToken)->patchJson("/api/v1/conversations/{$conversationId}/preferences", ['pinned' => true])
            ->assertOk()->assertJsonPath('data.isPinned', true);
        $this->withToken($clientToken)->patchJson("/api/v1/conversations/{$conversationId}/preferences", ['archived' => true])
            ->assertOk()->assertJsonPath('data.isPinned', false)->assertJsonPath('data.isArchived', true);
        $this->withToken($clientToken)->getJson('/api/v1/conversations?archived=true')
            ->assertOk()->assertJsonPath('data.0.id', $conversationId);
        $this->withToken($clientToken)->deleteJson("/api/v1/conversations/{$conversationId}")
            ->assertOk()->assertJsonPath('message', 'Conversation removed from Messages');
        $this->withToken($clientToken)->getJson('/api/v1/conversations?archived=true')
            ->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_requested_order_can_be_rejected_or_cancelled_and_completed_visibility_is_personal(): void
    {
        [$client, $clientToken] = $this->user('client3@example.com', 'Client Three', ['CLIENT']);
        [$provider, $providerToken] = $this->user('provider3@example.com', 'Provider Three', ['PROVIDER']);
        $serviceId = $this->fixedService($provider->id);
        $first = $this->createOrder($clientToken, $serviceId, 'First independent order requirements.');
        $second = $this->createOrder($clientToken, $serviceId, 'Second independent order requirements.');

        $this->withToken($providerToken)->postJson("/api/v1/orders/{$first}/reject", ['reason' => 'Schedule conflict'])
            ->assertOk()->assertJsonPath('data.status', 'REJECTED');
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$second}/cancel", ['reason' => 'Requirements changed'])
            ->assertOk()->assertJsonPath('data.status', 'CANCELLED');

        DB::table('Order')->where('id', $first)->update(['status' => 'COMPLETED', 'completedAt' => now()]);
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$first}/archive")
            ->assertOk()->assertJsonPath('data.view', 'archived');
        $this->withToken($clientToken)->getJson('/api/v1/orders?scope=client&view=active')->assertOk()->assertJsonMissing(['id' => $first]);
        $this->withToken($providerToken)->getJson('/api/v1/orders?scope=provider&view=active')->assertOk()->assertJsonFragment(['id' => $first]);
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$first}/restore")
            ->assertOk()->assertJsonPath('data.view', 'active');
    }

    public function test_paid_order_delivery_file_access_and_included_revision_round_trip(): void
    {
        Storage::fake('campusgig_private');
        [$client, $clientToken] = $this->user('delivery-client@example.com', 'Delivery Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('delivery-provider@example.com', 'Delivery Provider', ['PROVIDER']);
        $serviceId = $this->fixedService($provider->id);
        $orderId = $this->createOrder($clientToken, $serviceId, 'Create and deliver the final production assets.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();
        $paymentId = (string) Str::uuid();
        DB::table('Payment')->insert([
            'id' => $paymentId, 'orderId' => $orderId, 'idempotencyKey' => 'delivery-payment',
            'amountCentavos' => 105000, 'platformFeeCentavos' => 5000, 'providerNetCentavos' => 100000,
            'status' => 'PAID', 'currency' => 'PHP', 'refundedCentavos' => 0,
            'paidAt' => now(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/start")->assertOk();

        $requestId = (string) Str::uuid();
        $delivery = $this->withToken($providerToken)->post("/api/v1/orders/{$orderId}/deliver", [
            'note' => 'Initial production delivery',
            'clientRequestId' => $requestId,
            'files' => [$this->pdf('delivery.pdf', 'initial')],
        ])->assertOk()->assertJsonPath('data.status', 'SUBMITTED')
            ->assertJsonPath('data.reviewState', 'ACTIVE')
            ->assertJsonPath('data.currentDeliverySubmission.version', 1);
        $fileId = $delivery->json('data.currentDeliverySubmission.files.0.id');
        $storagePath = DB::table('OrderFile')->where('id', $fileId)->value('storagePath');
        Storage::disk('campusgig_private')->assertExists('order-files/'.$storagePath);

        $this->withToken($clientToken)->get("/api/v1/orders/{$orderId}/files/{$fileId}")->assertOk();
        $this->assertSame(1, DB::table('DeliveryFileAccessAudit')->where('fileId', $fileId)->count());
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/revision", [
            'instructions' => 'Please correct the final typography and spacing.',
        ])->assertOk()->assertJsonPath('data.status', 'REVISION_REQUESTED')
            ->assertJsonPath('data.revisionsUsed', 1)
            ->assertJsonPath('data.revisions.0.turnaroundMinutes', 2160);

        $this->withToken($providerToken)->post("/api/v1/orders/{$orderId}/deliver", [
            'note' => 'Corrected final delivery',
            'files' => [$this->pdf('corrected.pdf', 'corrected')],
        ])->assertOk()->assertJsonPath('data.status', 'SUBMITTED')
            ->assertJsonPath('data.currentDeliverySubmission.version', 2)
            ->assertJsonPath('data.revisions.0.status', 'RESOLVED');
        $this->assertSame(2, DB::table('DeliverySubmission')->where('orderId', $orderId)->count());

        $claim = $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/revisions/correction-claim", [
            'instructions' => 'The corrected typography still does not match the original approved requirements.',
        ])->assertOk()->assertJsonPath('data.type', 'PROVIDER_CORRECTION')
            ->assertJsonPath('data.status', 'AWAITING_PROVIDER_ACKNOWLEDGEMENT')
            ->assertJsonPath('data.turnaroundMinutes', 2160);
        $revisionId = $claim->json('data.id');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/revisions/{$revisionId}/correction-decision", [
            'accepted' => true,
        ])->assertOk()->assertJsonPath('data.status', 'OPEN')
            ->assertJsonPath('data.providerAcknowledgedAt', fn (mixed $value): bool => is_string($value));
        $this->assertSame('REVISION_REQUESTED', DB::table('Order')->where('id', $orderId)->value('status'));
        $this->assertSame(1, DB::table('Order')->where('id', $orderId)->value('revisionsUsed'));

        $this->withToken($providerToken)->post("/api/v1/orders/{$orderId}/deliver", [
            'note' => 'Provider-acknowledged correction delivery',
            'files' => [$this->pdf('provider-correction.pdf', 'provider correction')],
        ])->assertOk()->assertJsonPath('data.status', 'SUBMITTED')
            ->assertJsonPath('data.currentDeliverySubmission.version', 3)
            ->assertJsonPath('data.revisions.1.status', 'RESOLVED');
        $this->assertSame(3, DB::table('DeliverySubmission')->where('orderId', $orderId)->count());
        $this->assertSame(1, DB::table('Order')->where('id', $orderId)->value('revisionsUsed'));

        $declinedClaim = $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/revisions/correction-claim", [
            'instructions' => 'A second correction claim for the newest submitted delivery requires review.',
        ])->assertOk()->json('data.id');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/revisions/{$declinedClaim}/correction-decision", [
            'accepted' => false,
        ])->assertOk()->assertJsonPath('data.status', 'DECLINED')
            ->assertJsonPath('data.declinedAt', fn (mixed $value): bool => is_string($value));
        $this->assertSame('SUBMITTED', DB::table('Order')->where('id', $orderId)->value('status'));

        config([
            'campusgig.paymongo.mode' => 'test', 'campusgig.paymongo.secret_key' => 'sk_test_unit_key',
            'campusgig.paymongo.webhook_secret' => 'revision-webhook-secret',
            'campusgig.paymongo.success_url' => 'https://campusgig.net/orders/{ORDER_ID}/payment/return',
            'campusgig.paymongo.cancel_url' => 'https://campusgig.net/orders/{ORDER_ID}',
        ]);
        Http::fake(['api.paymongo.com/*' => Http::response([
            'data' => ['id' => 'cs_revision_1', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/test/revision']],
        ])]);
        $this->withToken($clientToken)->getJson("/api/v1/orders/{$orderId}/payments/revision-quote")
            ->assertOk()->assertJsonPath('data.providerSubtotalCentavos', 10000)
            ->assertJsonPath('data.platformFeeCentavos', 500)
            ->assertJsonPath('data.clientTotalCentavos', 10500)
            ->assertJsonPath('data.turnaroundMinutes', 2160);
        $checkout = $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/payments/revision-checkout", [
            'instructions' => 'Please apply one final paid revision to the approved production assets.',
            'returnTarget' => 'WEB',
        ])->assertOk()->assertJsonPath('data.paymentStatus', 'REQUIRES_ACTION')
            ->assertJsonPath('checkoutUrl', 'https://checkout.paymongo.com/test/revision');
        $purchaseId = $checkout->json('data.id');
        Http::assertSent(fn ($request): bool => data_get($request->data(), 'data.attributes.line_items.0.amount') === 10500
            && str_contains(data_get($request->data(), 'data.attributes.success_url', ''), "revisionPurchaseId={$purchaseId}"));

        $paidAt = now()->timestamp;
        $payload = ['data' => [
            'id' => 'evt_revision_paid_1', 'type' => 'event',
            'attributes' => ['type' => 'checkout_session.payment.paid', 'livemode' => false, 'data' => [
                'id' => 'cs_revision_1', 'type' => 'checkout_session', 'attributes' => ['payments' => [[
                    'id' => 'pay_revision_1', 'attributes' => [
                        'amount' => 10500, 'currency' => 'PHP', 'paid_at' => $paidAt,
                    ],
                ]]],
            ]],
        ]];
        $raw = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$raw, 'revision-webhook-secret');
        $this->call('POST', '/api/v1/payments/paymongo/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json', 'HTTP_PAYMONGO_SIGNATURE' => "t={$timestamp},te={$signature}",
        ], $raw)->assertOk();
        $this->assertSame('ACTIVATED', DB::table('OrderRevisionPurchase')->where('id', $purchaseId)->value('activationStatus'));
        $this->assertSame('REVISION_REQUESTED', DB::table('Order')->where('id', $orderId)->value('status'));
        $this->assertSame(10000, DB::table('ProviderEarning')->where('revisionPurchaseId', $purchaseId)->value('grossServiceAmountCentavos'));

        $this->withToken($providerToken)->post("/api/v1/orders/{$orderId}/deliver", [
            'note' => 'Completed paid extra revision',
            'files' => [$this->pdf('paid-extra-revision.pdf', 'paid extra revision')],
        ])->assertOk()->assertJsonPath('data.status', 'SUBMITTED')
            ->assertJsonPath('data.currentDeliverySubmission.version', 4)
            ->assertJsonPath('data.revisionPurchases.0.paymentStatus', 'PAID')
            ->assertJsonPath('data.revisionPurchases.0.activationStatus', 'ACTIVATED');
    }

    public function test_paymongo_checkout_and_signed_paid_webhook_create_authoritative_ledger(): void
    {
        Storage::fake('campusgig_private');
        config([
            'campusgig.paymongo.mode' => 'test',
            'campusgig.paymongo.secret_key' => 'sk_test_unit_key',
            'campusgig.paymongo.webhook_secret' => 'webhook-test-secret',
            'campusgig.paymongo.success_url' => 'https://campusgig.net/orders/{ORDER_ID}/payment/return',
            'campusgig.paymongo.cancel_url' => 'https://campusgig.net/orders/{ORDER_ID}',
        ]);
        Http::fake([
            'api.paymongo.com/*' => Http::response([
                'data' => ['id' => 'cs_test_123', 'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/test/123']],
            ]),
        ]);
        [$client, $clientToken] = $this->user('payment-client@example.com', 'Payment Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('payment-provider@example.com', 'Payment Provider', ['PROVIDER']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Build the complete payment-tested service.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();

        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/payments/checkout", ['returnTarget' => 'WEB'])
            ->assertOk()->assertJsonPath('data.status', 'REQUIRES_ACTION')
            ->assertJsonPath('checkoutUrl', 'https://checkout.paymongo.com/test/123');
        Http::assertSent(fn ($request): bool => data_get($request->data(), 'data.attributes.line_items.0.amount') === 105000
            && str_contains(data_get($request->data(), 'data.attributes.success_url', ''), $orderId));

        $paidAt = now()->timestamp;
        $payload = [
            'data' => [
                'id' => 'evt_test_paid_123', 'type' => 'event',
                'attributes' => [
                    'type' => 'checkout_session.payment.paid', 'livemode' => false,
                    'data' => [
                        'id' => 'cs_test_123', 'type' => 'checkout_session',
                        'attributes' => ['payments' => [[
                            'id' => 'pay_test_123',
                            'attributes' => ['amount' => 105000, 'currency' => 'PHP', 'paid_at' => $paidAt],
                        ]]],
                    ],
                ],
            ],
        ];
        $raw = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$raw, 'webhook-test-secret');
        $headers = ['CONTENT_TYPE' => 'application/json', 'HTTP_PAYMONGO_SIGNATURE' => "t={$timestamp},te={$signature}"];
        $this->call('POST', '/api/v1/payments/paymongo/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json'], $raw)
            ->assertUnauthorized();
        $this->assertSame(0, DB::table('PaymentWebhookEvent')->count());
        $this->call('POST', '/api/v1/payments/paymongo/webhook', [], [], [], $headers, $raw)
            ->assertOk()->assertJson(['received' => true, 'duplicate' => false]);
        $this->assertSame('PAID', DB::table('Payment')->where('orderId', $orderId)->value('status'));
        $this->assertNotNull(DB::table('Order')->where('id', $orderId)->value('dueAt'));
        $this->assertSame(100000, DB::table('ProviderEarning')->where('orderId', $orderId)->value('grossServiceAmountCentavos'));
        $this->assertSame(100000, DB::table('ProviderEarningLedgerEntry')->where('orderId', $orderId)->value('amountCentavos'));

        $this->call('POST', '/api/v1/payments/paymongo/webhook', [], [], [], $headers, $raw)
            ->assertOk()->assertJson(['received' => true, 'duplicate' => true]);
        $this->assertSame(1, DB::table('ProviderEarning')->where('orderId', $orderId)->count());
        $this->withToken($clientToken)->getJson("/api/v1/orders/{$orderId}/payments")
            ->assertOk()->assertJsonPath('data.0.status', 'PAID');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/start")->assertOk();
        $this->withToken($providerToken)->post("/api/v1/orders/{$orderId}/deliver", [
            'note' => 'Final paid delivery', 'files' => [$this->pdf('paid-delivery.pdf', 'paid final')],
        ])->assertOk()->assertJsonPath('data.status', 'SUBMITTED');
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/complete")
            ->assertOk()->assertJsonPath('data.status', 'COMPLETED')
            ->assertJsonPath('data.completionSource', 'CLIENT_ACCEPTED');
        $this->assertSame('AVAILABLE', DB::table('ProviderEarning')->where('orderId', $orderId)->value('status'));
        $this->assertSame(1, DB::table('StudentProfile')->where('userId', $provider->id)->value('completedOrderCount'));
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/review", [
            'overallRating' => 5, 'qualityRating' => 5, 'communicationRating' => 4,
            'timelinessRating' => 5, 'comment' => 'Excellent production delivery.',
        ])->assertOk()->assertJsonPath('data.overallRating', 5);
        $this->assertSame(1, DB::table('StudentProfile')->where('userId', $provider->id)->value('reviewCount'));
    }

    public function test_client_can_receive_an_accounted_full_refund_before_work_starts(): void
    {
        config([
            'campusgig.paymongo.mode' => 'test',
            'campusgig.paymongo.secret_key' => 'sk_test_unit_key',
        ]);
        Http::fake([
            'api.paymongo.com/v1/refunds' => Http::response([
                'data' => [
                    'id' => 'refund_test_1',
                    'attributes' => [
                        'amount' => 105000, 'currency' => 'PHP', 'payment_id' => 'pay_refund_test_1',
                        'reason' => 'others', 'status' => 'succeeded',
                        'created_at' => now()->timestamp, 'updated_at' => now()->timestamp,
                    ],
                ],
            ]),
        ]);
        [$client, $clientToken] = $this->user('refund-client@example.com', 'Refund Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('refund-provider@example.com', 'Refund Provider', ['PROVIDER']);
        [, $adminToken] = $this->user('refund-admin@example.com', 'Refund Admin', ['ADMIN']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Build a refundable production service.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();
        $paymentId = (string) Str::uuid();
        $earningId = (string) Str::uuid();
        DB::table('Payment')->insert([
            'id' => $paymentId, 'orderId' => $orderId, 'providerPaymentId' => 'pay_refund_test_1',
            'idempotencyKey' => 'refund-payment', 'amountCentavos' => 105000,
            'platformFeeCentavos' => 5000, 'providerNetCentavos' => 100000,
            'status' => 'PAID', 'currency' => 'PHP', 'paidAt' => now(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('ProviderEarning')->insert([
            'id' => $earningId, 'providerId' => $provider->id, 'orderId' => $orderId, 'paymentId' => $paymentId,
            'sourceType' => 'ORIGINAL_ORDER', 'currency' => 'PHP', 'grossServiceAmountCentavos' => 100000,
            'status' => 'PENDING', 'pendingAt' => now(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('ProviderEarningLedgerEntry')->insert([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
            'orderId' => $orderId, 'sourcePaymentId' => $paymentId, 'type' => 'EARNING_PENDING_CREDIT',
            'amountCentavos' => 100000, 'currency' => 'PHP', 'sourceKey' => 'refund-pending-credit', 'createdAt' => now(),
        ]);

        $this->withToken($clientToken)->getJson("/api/v1/orders/{$orderId}/payments/refund-eligibility")
            ->assertOk()->assertJsonPath('data.canRequest', true)
            ->assertJsonPath('data.eligibleReasons.0', 'PAID_NOT_STARTED')
            ->assertJsonPath('data.payment.refundTotalCentavos', 105000);

        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/payments/refunds", [
            'reason' => 'PAID_NOT_STARTED',
        ])->assertOk()->assertJsonPath('data.status', 'SUCCEEDED')
            ->assertJsonPath('data.refundTotalCentavos', 105000);

        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/payments/refunds", [
            'reason' => 'PAID_NOT_STARTED',
        ])->assertOk()->assertJsonPath('data.status', 'SUCCEEDED');

        Http::assertSent(fn ($request): bool => $request->url() === 'https://api.paymongo.com/v1/refunds'
            && $request->hasHeader('Idempotency-Key')
            && data_get($request->data(), 'data.attributes.amount') === 105000
            && data_get($request->data(), 'data.attributes.payment_id') === 'pay_refund_test_1');
        $this->assertSame(1, Http::recorded()->count());
        $this->assertSame('CANCELLED', DB::table('Order')->where('id', $orderId)->value('status'));
        $this->assertSame('REFUNDED', DB::table('Payment')->where('id', $paymentId)->value('status'));
        $this->assertSame(105000, DB::table('Payment')->where('id', $paymentId)->value('refundedCentavos'));
        $this->assertSame('REFUNDED', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(-100000, DB::table('ProviderEarningLedgerEntry')->where('type', 'EARNING_REFUND_REVERSAL')->value('amountCentavos'));
        $this->assertSame(-5000, DB::table('PlatformFeeLedgerEntry')->where('orderId', $orderId)->value('amountCentavos'));
        $this->assertSame(2, DB::table('Notification')->where('orderId', $orderId)->where('type', 'ORDER_REFUNDED')->count());

        $webhook = [
            'data' => [
                'id' => 'evt_refund_updated_1', 'type' => 'event',
                'attributes' => [
                    'type' => 'payment.refund.updated', 'livemode' => false,
                    'data' => [
                        'id' => 'refund_test_1', 'type' => 'refund',
                        'attributes' => [
                            'amount' => 105000, 'currency' => 'PHP', 'payment_id' => 'pay_refund_test_1',
                            'reason' => 'others', 'status' => 'succeeded',
                            'created_at' => now()->timestamp, 'updated_at' => now()->timestamp,
                        ],
                    ],
                ],
            ],
        ];
        $raw = json_encode($webhook, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $timestamp = (string) time();
        $signature = hash_hmac('sha256', $timestamp.'.'.$raw, 'refund-webhook-secret');
        config(['campusgig.paymongo.webhook_secret' => 'refund-webhook-secret']);
        $this->call('POST', '/api/v1/payments/paymongo/webhook', [], [], [], [
            'CONTENT_TYPE' => 'application/json', 'HTTP_PAYMONGO_SIGNATURE' => "t={$timestamp},te={$signature}",
        ], $raw)->assertOk()->assertJson(['received' => true, 'duplicate' => false]);
        $this->assertSame(1, DB::table('ProviderEarningLedgerEntry')->where('type', 'EARNING_REFUND_REVERSAL')->count());
        $this->assertSame(1, DB::table('PlatformFeeLedgerEntry')->where('orderId', $orderId)->count());
        $this->assertSame(2, DB::table('Notification')->where('orderId', $orderId)->where('type', 'ORDER_REFUNDED')->count());
        $this->withToken($clientToken)->getJson("/api/v1/orders/{$orderId}/payments")
            ->assertOk()->assertJsonPath('data.0.status', 'REFUNDED')
            ->assertJsonPath('data.0.refunds.0.status', 'SUCCEEDED')
            ->assertJsonPath('data.0.refunds.0.providerRefundId', 'refund_test_1');
        $refundId = DB::table('PaymentRefund')->where('paymentId', $paymentId)->value('id');
        $this->withToken($clientToken)->getJson('/api/v1/admin/refunds')->assertForbidden();
        $this->withToken($adminToken)->getJson('/api/v1/admin/refunds?status=SUCCEEDED&limit=10')
            ->assertOk()->assertJsonPath('data.0.id', $refundId)
            ->assertJsonPath('data.0.order.orderNumber', fn (mixed $value): bool => is_string($value));
        $this->withToken($adminToken)->getJson("/api/v1/admin/refunds/{$refundId}")
            ->assertOk()->assertJsonPath('data.status', 'SUCCEEDED');
        $this->withToken($adminToken)->postJson("/api/v1/admin/refunds/{$refundId}/reconcile")
            ->assertOk()->assertJsonPath('data.status', 'SUCCEEDED');
    }

    public function test_dispute_freezes_earning_collects_private_evidence_and_requires_admin_review(): void
    {
        Storage::fake('campusgig_private');
        [$client, $clientToken] = $this->user('dispute-client@example.com', 'Dispute Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('dispute-provider@example.com', 'Dispute Provider', ['PROVIDER']);
        [, $adminToken] = $this->user('dispute-admin@example.com', 'Dispute Admin', ['ADMIN']);
        [, $outsiderToken] = $this->user('dispute-outsider@example.com', 'Dispute Outsider', ['CLIENT']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Produce a reviewed delivery with dispute evidence.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();
        $paymentId = (string) Str::uuid();
        $earningId = (string) Str::uuid();
        $deliveryId = (string) Str::uuid();
        DB::table('Payment')->insert([
            'id' => $paymentId, 'orderId' => $orderId, 'providerPaymentId' => 'pay_dispute_1',
            'idempotencyKey' => 'dispute-payment', 'amountCentavos' => 105000,
            'platformFeeCentavos' => 5000, 'providerNetCentavos' => 100000,
            'status' => 'PAID', 'refundedCentavos' => 0, 'currency' => 'PHP',
            'paidAt' => now()->subDay(), 'createdAt' => now()->subDay(), 'updatedAt' => now(),
        ]);
        DB::table('DeliverySubmission')->insert([
            'id' => $deliveryId, 'orderId' => $orderId, 'providerId' => $provider->id,
            'version' => 1, 'note' => 'Delivery under review', 'submittedAt' => now(), 'createdAt' => now(),
        ]);
        DB::table('Order')->where('id', $orderId)->update([
            'status' => 'SUBMITTED', 'submittedAt' => now(), 'reviewPolicyVersion' => 1,
            'reviewStartedAt' => now(), 'reviewDeadlineAt' => now()->addHours(40),
            'reviewDeliverySubmissionId' => $deliveryId,
        ]);
        DB::table('ProviderEarning')->insert([
            'id' => $earningId, 'providerId' => $provider->id, 'orderId' => $orderId, 'paymentId' => $paymentId,
            'sourceType' => 'ORIGINAL_ORDER', 'currency' => 'PHP', 'grossServiceAmountCentavos' => 100000,
            'status' => 'PENDING', 'pendingAt' => now()->subDay(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('ProviderEarningLedgerEntry')->insert([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
            'orderId' => $orderId, 'sourcePaymentId' => $paymentId, 'type' => 'EARNING_PENDING_CREDIT',
            'amountCentavos' => 100000, 'currency' => 'PHP', 'sourceKey' => 'dispute-pending-credit', 'createdAt' => now(),
        ]);

        $opened = $this->withToken($clientToken)->post("/api/v1/orders/{$orderId}/disputes", [
            'reason' => 'QUALITY_ISSUE', 'details' => 'The submitted result does not match the approved brief.',
            'files' => [$this->pdf('client-evidence.pdf', 'client evidence')],
        ])->assertCreated()->assertJsonPath('data.status', 'WAITING_FOR_PROVIDER')
            ->assertJsonPath('data.responseRequestedFrom', 'PROVIDER')
            ->assertJsonPath('data.evidence.0.originalName', 'client-evidence.pdf')->json('data');
        $disputeId = $opened['id'];
        $evidenceId = $opened['evidence'][0]['id'];
        $this->assertSame('FROZEN', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(1, DB::table('ProviderEarningLedgerEntry')->where('type', 'EARNING_FROZEN')->count());
        $this->withToken($outsiderToken)->getJson("/api/v1/orders/{$orderId}/disputes")->assertNotFound();
        $this->withToken($clientToken)->get("/api/v1/orders/{$orderId}/disputes/{$disputeId}/evidence/{$evidenceId}")
            ->assertOk()->assertHeader('cache-control', 'no-store, private');

        $this->withToken($providerToken)->post("/api/v1/orders/{$orderId}/disputes/{$disputeId}/responses", [
            'details' => 'The provider response and source files explain the submitted result.',
            'files' => [$this->pdf('provider-response.pdf', 'provider response')],
        ])->assertOk()->assertJsonPath('data.status', 'READY_FOR_REVIEW')
            ->assertJsonCount(1, 'data.responses')->assertJsonCount(2, 'data.evidence');
        $this->withToken($clientToken)->getJson('/api/v1/admin/disputes')->assertForbidden();
        $this->withToken($adminToken)->getJson('/api/v1/admin/disputes?status=READY_FOR_REVIEW')
            ->assertOk()->assertJsonPath('data.0.id', $disputeId)
            ->assertJsonPath('data.0.order.orderNumber', fn (mixed $value): bool => is_string($value));
        $this->withToken($adminToken)->postJson("/api/v1/admin/disputes/{$disputeId}/review")
            ->assertOk()->assertJsonPath('data.status', 'UNDER_REVIEW');
        $this->withToken($adminToken)->postJson("/api/v1/admin/disputes/{$disputeId}/resolve", [
            'status' => 'RESOLVED_PROVIDER', 'resolutionNote' => 'Evidence supports the submitted delivery.',
        ])->assertOk()->assertJsonPath('data.status', 'RESOLVED_PROVIDER')
            ->assertJsonPath('data.resolutionNote', 'Evidence supports the submitted delivery.');

        $this->assertSame('PENDING', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(1, DB::table('ProviderEarningLedgerEntry')->where('type', 'EARNING_UNFROZEN')->count());
        $this->assertNotNull(DB::table('DisputeAffectedEarning')->where('disputeId', $disputeId)->value('restoredAt'));
        $this->assertTrue(now()->lessThan(DB::table('Order')->where('id', $orderId)->value('reviewDeadlineAt')));

        $expiredId = $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/disputes", [
            'reason' => 'OTHER', 'details' => 'A second case is used to verify deadline reconciliation.',
        ])->assertCreated()->json('data.id');
        DB::table('OrderDispute')->where('id', $expiredId)->update(['responseDeadlineAt' => now()->subMinute()]);
        $this->artisan('disputes:reconcile-expired-responses')
            ->expectsOutput('Moved 1 expired dispute response(s) to admin review.')->assertExitCode(0);
        $this->assertSame('READY_FOR_REVIEW', DB::table('OrderDispute')->where('id', $expiredId)->value('status'));
        $this->assertSame(1, DB::table('DisputeTimelineEvent')->where('disputeId', $expiredId)
            ->where('type', 'RESPONSE_DEADLINE_EXPIRED')->count());
    }

    public function test_admin_can_refund_a_stale_paid_revision_with_complete_accounting(): void
    {
        config(['campusgig.paymongo.mode' => 'test', 'campusgig.paymongo.secret_key' => 'sk_test_unit_key']);
        Http::fake(['api.paymongo.com/v1/refunds' => Http::response(['data' => [
            'id' => 'refund_stale_revision_1', 'attributes' => [
                'amount' => 2100, 'currency' => 'PHP', 'payment_id' => 'pay_stale_revision_1',
                'reason' => 'others', 'status' => 'succeeded',
                'created_at' => now()->timestamp, 'updated_at' => now()->timestamp,
            ],
        ]])]);
        [$client, $clientToken] = $this->user('stale-client@example.com', 'Stale Client', ['CLIENT']);
        [$provider] = $this->user('stale-provider@example.com', 'Stale Provider', ['PROVIDER']);
        [, $adminToken] = $this->user('stale-admin@example.com', 'Stale Admin', ['ADMIN']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Create an order with a stale paid revision.');
        $deliveryId = (string) Str::uuid();
        DB::table('DeliverySubmission')->insert([
            'id' => $deliveryId, 'orderId' => $orderId, 'providerId' => $provider->id,
            'version' => 1, 'note' => 'Source delivery', 'submittedAt' => now(), 'createdAt' => now(),
        ]);
        $purchaseId = (string) Str::uuid();
        DB::table('OrderRevisionPurchase')->insert([
            'id' => $purchaseId, 'orderId' => $orderId, 'sourceDeliverySubmissionId' => $deliveryId,
            'clientId' => $client->id, 'providerId' => $provider->id, 'instructions' => 'Correct the paid revision.',
            'providerSubtotalCentavos' => 2000, 'platformFeeCentavos' => 100, 'totalCentavos' => 2100,
            'currency' => 'PHP', 'turnaroundMinutes' => 180, 'pricingPolicyVersion' => 1,
            'pricingBasisCentavos' => 100000, 'deliveryDurationBasisMinutes' => 4320,
            'providerPaymentId' => 'pay_stale_revision_1', 'idempotencyKey' => 'stale-revision-purchase',
            'paymentStatus' => 'PAID', 'activationStatus' => 'RECONCILIATION_REQUIRED',
            'failureCode' => 'stale_order_state_after_payment', 'paidAt' => now(), 'refundedCentavos' => 0,
            'createdAt' => now(), 'updatedAt' => now(),
        ]);

        $this->withToken($adminToken)->getJson('/api/v1/admin/refunds/stale-revisions')
            ->assertOk()->assertJsonPath('data.0.id', $purchaseId);
        $this->withToken($adminToken)->postJson("/api/v1/admin/refunds/stale-revisions/{$purchaseId}")
            ->assertOk()->assertJsonPath('data.status', 'SUCCEEDED')
            ->assertJsonPath('data.sourceType', 'PAID_EXTRA_REVISION')
            ->assertJsonPath('data.revisionPurchaseId', $purchaseId);
        $this->assertSame('REFUNDED', DB::table('OrderRevisionPurchase')->where('id', $purchaseId)->value('paymentStatus'));
        $this->assertSame('REFUNDED', DB::table('OrderRevisionPurchase')->where('id', $purchaseId)->value('activationStatus'));
        $this->assertSame(2100, DB::table('OrderRevisionPurchase')->where('id', $purchaseId)->value('refundedCentavos'));
        $earning = DB::table('ProviderEarning')->where('revisionPurchaseId', $purchaseId)->first();
        $this->assertSame('REFUNDED', $earning->status);
        $this->assertSame(-2000, DB::table('ProviderEarningLedgerEntry')->where('type', 'EARNING_REFUND_REVERSAL')->value('amountCentavos'));
        $this->assertSame(-100, DB::table('PlatformFeeLedgerEntry')->where('orderId', $orderId)->value('amountCentavos'));
        $this->assertSame(2, DB::table('Notification')->where('orderId', $orderId)->where('type', 'ORDER_REFUNDED')->count());
        $this->assertSame(1, Http::recorded()->count());
    }

    public function test_client_favoring_dispute_can_issue_the_original_payment_refund_once(): void
    {
        config(['campusgig.paymongo.mode' => 'test', 'campusgig.paymongo.secret_key' => 'sk_test_unit_key']);
        Http::fake(['api.paymongo.com/v1/refunds' => Http::response(['data' => [
            'id' => 'refund_dispute_win_1', 'attributes' => [
                'amount' => 105000, 'currency' => 'PHP', 'payment_id' => 'pay_dispute_win_1',
                'reason' => 'others', 'status' => 'succeeded',
                'created_at' => now()->timestamp, 'updated_at' => now()->timestamp,
            ],
        ]])]);
        [$client, $clientToken] = $this->user('win-client@example.com', 'Winning Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('win-provider@example.com', 'Win Provider', ['PROVIDER']);
        [$admin, $adminToken] = $this->user('win-admin@example.com', 'Win Admin', ['ADMIN']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Create an order for dispute refund adjudication.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();
        $paymentId = (string) Str::uuid();
        $earningId = (string) Str::uuid();
        DB::table('Payment')->insert([
            'id' => $paymentId, 'orderId' => $orderId, 'providerPaymentId' => 'pay_dispute_win_1',
            'idempotencyKey' => 'dispute-win-payment', 'amountCentavos' => 105000,
            'platformFeeCentavos' => 5000, 'providerNetCentavos' => 100000,
            'status' => 'PAID', 'refundedCentavos' => 0, 'currency' => 'PHP',
            'paidAt' => now(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('ProviderEarning')->insert([
            'id' => $earningId, 'providerId' => $provider->id, 'orderId' => $orderId, 'paymentId' => $paymentId,
            'sourceType' => 'ORIGINAL_ORDER', 'currency' => 'PHP', 'grossServiceAmountCentavos' => 100000,
            'status' => 'FROZEN', 'pendingAt' => now(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('ProviderEarningLedgerEntry')->insert([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
            'orderId' => $orderId, 'sourcePaymentId' => $paymentId, 'type' => 'EARNING_PENDING_CREDIT',
            'amountCentavos' => 100000, 'currency' => 'PHP', 'sourceKey' => 'dispute-win-credit', 'createdAt' => now(),
        ]);
        $disputeId = (string) Str::uuid();
        DB::table('OrderDispute')->insert([
            'id' => $disputeId, 'orderId' => $orderId, 'openedById' => $client->id,
            'reason' => 'QUALITY_ISSUE', 'details' => 'The administrator reviewed the supplied evidence.',
            'status' => 'RESOLVED_CLIENT', 'responseRequestSequence' => 1,
            'resolutionNote' => 'The client evidence supports a full refund.', 'resolvedById' => $admin->id,
            'resolvedAt' => now(), 'createdAt' => now(), 'updatedAt' => now(),
        ]);

        $first = $this->withToken($adminToken)->postJson("/api/v1/admin/refunds/disputes/{$disputeId}")
            ->assertOk()->assertJsonPath('data.status', 'SUCCEEDED')
            ->assertJsonPath('data.triggeringDisputeId', $disputeId)->json('data.id');
        $this->withToken($adminToken)->postJson("/api/v1/admin/refunds/disputes/{$disputeId}")
            ->assertOk()->assertJsonPath('data.id', $first)->assertJsonPath('data.status', 'SUCCEEDED');
        $this->assertSame(1, Http::recorded()->count());
        $this->assertSame('REFUNDED', DB::table('Payment')->where('id', $paymentId)->value('status'));
        $this->assertSame('REFUNDED', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(1, DB::table('PlatformFeeLedgerEntry')->where('orderId', $orderId)->count());
    }

    public function test_payment_read_safely_reconciles_a_paid_checkout_when_webhook_is_delayed(): void
    {
        config([
            'campusgig.paymongo.mode' => 'test',
            'campusgig.paymongo.secret_key' => 'sk_test_unit_key',
            'campusgig.paymongo.success_url' => 'https://campusgig.net/orders/{ORDER_ID}/payment/return',
            'campusgig.paymongo.cancel_url' => 'https://campusgig.net/orders/{ORDER_ID}',
        ]);
        Http::fake(fn ($request) => $request->method() === 'POST'
            ? Http::response(['data' => [
                'id' => 'cs_reconcile_1',
                'attributes' => ['checkout_url' => 'https://checkout.paymongo.com/test/reconcile'],
            ]])
            : Http::response(['data' => [
                'id' => 'cs_reconcile_1',
                'attributes' => ['payments' => [[
                    'id' => 'pay_reconcile_1',
                    'attributes' => [
                        'status' => 'paid', 'amount' => 105000, 'currency' => 'PHP', 'paid_at' => now()->timestamp,
                    ],
                ]]],
            ]]));
        [$client, $clientToken] = $this->user('reconcile-client@example.com', 'Reconcile Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('reconcile-provider@example.com', 'Reconcile Provider', ['PROVIDER']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Reconcile delayed payment confirmation.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();
        $this->withToken($clientToken)->postJson("/api/v1/orders/{$orderId}/payments/checkout", ['returnTarget' => 'WEB'])
            ->assertOk()->assertJsonPath('data.status', 'REQUIRES_ACTION');

        $this->withToken($clientToken)->getJson("/api/v1/orders/{$orderId}/payments")
            ->assertOk()->assertJsonPath('data.0.status', 'PAID')
            ->assertJsonPath('data.0.paidAt', fn (mixed $value): bool => is_string($value));
        $this->assertSame('pay_reconcile_1', DB::table('Payment')->where('orderId', $orderId)->value('providerPaymentId'));
        $this->assertSame(1, DB::table('ProviderEarning')->where('orderId', $orderId)->count());
        $this->assertSame(100000, DB::table('ProviderEarningLedgerEntry')->where('orderId', $orderId)->value('amountCentavos'));
        $this->assertNotNull(DB::table('Order')->where('id', $orderId)->value('dueAt'));
        $this->assertSame(0, DB::table('PaymentWebhookEvent')->count());
        $this->assertSame(2, Http::recorded()->count());
    }

    public function test_expired_delivery_review_is_completed_and_earning_released_by_scheduler(): void
    {
        [$client, $clientToken] = $this->user('timeout-client@example.com', 'Timeout Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('timeout-provider@example.com', 'Timeout Provider', ['PROVIDER']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Deliver work for automatic review completion.');
        $this->withToken($providerToken)->postJson("/api/v1/orders/{$orderId}/accept")->assertOk();
        $paymentId = (string) Str::uuid();
        $earningId = (string) Str::uuid();
        $deliveryId = (string) Str::uuid();
        $submittedAt = now()->subHours(49);
        DB::table('Payment')->insert([
            'id' => $paymentId, 'orderId' => $orderId, 'idempotencyKey' => 'timeout-payment',
            'amountCentavos' => 105000, 'platformFeeCentavos' => 5000, 'providerNetCentavos' => 100000,
            'status' => 'PAID', 'paidAt' => now()->subDays(3), 'createdAt' => now()->subDays(3), 'updatedAt' => now(),
        ]);
        DB::table('DeliverySubmission')->insert([
            'id' => $deliveryId, 'orderId' => $orderId, 'providerId' => $provider->id,
            'version' => 1, 'note' => 'Timed delivery', 'submittedAt' => $submittedAt, 'createdAt' => $submittedAt,
        ]);
        DB::table('Order')->where('id', $orderId)->update([
            'status' => 'SUBMITTED', 'submittedAt' => $submittedAt, 'reviewPolicyVersion' => 1,
            'reviewStartedAt' => $submittedAt, 'reviewDeadlineAt' => now()->subHour(),
            'reviewDeliverySubmissionId' => $deliveryId,
        ]);
        DB::table('ProviderEarning')->insert([
            'id' => $earningId, 'providerId' => $provider->id, 'orderId' => $orderId, 'paymentId' => $paymentId,
            'sourceType' => 'ORIGINAL_ORDER', 'currency' => 'PHP', 'grossServiceAmountCentavos' => 100000,
            'status' => 'PENDING', 'pendingAt' => now()->subDays(3), 'createdAt' => now(), 'updatedAt' => now(),
        ]);
        DB::table('ProviderEarningLedgerEntry')->insert([
            'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
            'orderId' => $orderId, 'sourcePaymentId' => $paymentId, 'type' => 'EARNING_PENDING_CREDIT',
            'amountCentavos' => 100000, 'currency' => 'PHP', 'sourceKey' => 'timeout-pending-credit', 'createdAt' => now(),
        ]);

        $this->artisan('orders:reconcile-expired-reviews')->expectsOutput('Completed 1 expired order review(s).')->assertExitCode(0);
        $this->assertSame('COMPLETED', DB::table('Order')->where('id', $orderId)->value('status'));
        $this->assertSame('AUTO_REVIEW_TIMEOUT', DB::table('Order')->where('id', $orderId)->value('completionSource'));
        $this->assertSame('AVAILABLE', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(2, DB::table('Notification')->where('orderId', $orderId)->where('type', 'ORDER_AUTO_COMPLETED')->count());
    }

    public function test_provider_earnings_and_manual_payout_lifecycle_preserve_accounting_invariants(): void
    {
        [$client, $clientToken] = $this->user('payout-client@example.com', 'Payout Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('payout-provider@example.com', 'Payout Provider', ['PROVIDER']);
        [, $adminToken] = $this->user('payout-admin@example.com', 'Payout Admin', ['ADMIN']);
        [, $otherProviderToken] = $this->user('other-payout-provider@example.com', 'Other Provider', ['PROVIDER']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Build the payout accounting test order safely.');
        $earningId = (string) Str::uuid();
        $availableAt = now()->subDays(2);
        DB::table('ProviderEarning')->insert([
            'id' => $earningId, 'providerId' => $provider->id, 'orderId' => $orderId,
            'sourceType' => 'ORIGINAL_ORDER', 'currency' => 'PHP', 'grossServiceAmountCentavos' => 100000,
            'status' => 'AVAILABLE', 'pendingAt' => now()->subDays(3), 'availableAt' => $availableAt,
            'createdAt' => now()->subDays(3), 'updatedAt' => $availableAt,
        ]);
        DB::table('ProviderEarningLedgerEntry')->insert([
            [
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
                'orderId' => $orderId, 'type' => 'EARNING_PENDING_CREDIT', 'amountCentavos' => 100000,
                'currency' => 'PHP', 'sourceKey' => 'payout-credit', 'createdAt' => now()->subDays(3),
            ],
            [
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
                'orderId' => $orderId, 'type' => 'EARNING_AVAILABLE_RELEASE', 'amountCentavos' => 0,
                'currency' => 'PHP', 'sourceKey' => 'payout-release', 'createdAt' => $availableAt,
            ],
        ]);

        $this->withToken($providerToken)->getJson('/api/v1/provider/earnings/summary')->assertOk()
            ->assertJsonPath('data.0.currency', 'PHP')->assertJsonPath('data.0.availableCentavos', 100000)
            ->assertJsonPath('data.0.withdrawableCentavos', 100000);
        $this->withToken($providerToken)->getJson('/api/v1/provider/earnings?limit=1')->assertOk()
            ->assertJsonPath('data.0.id', $earningId)->assertJsonPath('data.0.isWithdrawable', true)
            ->assertJsonPath('data.0.entries.1.type', 'EARNING_AVAILABLE_RELEASE');

        $destinationId = $this->withToken($providerToken)->postJson('/api/v1/provider/payouts/destinations', [
            'type' => 'E_WALLET', 'displayLabel' => 'Primary GCash',
            'accountIdentifier' => '0917-123-4567', 'accountHolderName' => 'Payout Provider',
        ])->assertOk()->assertJsonPath('data.maskedAccountIdentifier', '•••• 4567')
            ->assertJsonPath('data.verificationStatus', 'UNVERIFIED')->json('data.id');
        $this->assertDatabaseMissing('ProviderPayoutDestination', ['id' => $destinationId, 'maskedAccountIdentifier' => '09171234567']);
        $encryptedIdentifier = DB::table('ProviderPayoutDestination')->where('id', $destinationId)->value('externalReferenceToken');
        $this->assertIsString($encryptedIdentifier);
        $this->assertStringNotContainsString('09171234567', $encryptedIdentifier);
        $this->withToken($providerToken)->getJson("/api/v1/admin/payouts/destinations/{$destinationId}/sensitive-details")
            ->assertForbidden();
        $this->withToken($adminToken)->getJson("/api/v1/admin/payouts/destinations/{$destinationId}/sensitive-details")
            ->assertOk()->assertJsonPath('data.accountIdentifier', '09171234567')
            ->assertJsonPath('data.accountHolderName', 'Payout Provider');
        DB::table('ProviderPayoutDestination')->where('id', $destinationId)->update(['externalReferenceToken' => null]);
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/destinations/{$destinationId}/review", [
            'note' => 'Legacy destination cannot be approved without secure transfer details.',
        ])->assertStatus(409);
        DB::table('ProviderPayoutDestination')->where('id', $destinationId)->update(['externalReferenceToken' => $encryptedIdentifier]);
        $this->withToken($providerToken)->postJson('/api/v1/provider/payouts', [
            'destinationId' => $destinationId, 'clientRequestId' => (string) Str::uuid(), 'currency' => 'PHP',
        ])->assertStatus(409);
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/destinations/{$destinationId}/review", [
            'note' => 'Identity and destination ownership were checked manually.',
        ])->assertOk()->assertJsonPath('data.verificationStatus', 'ADMIN_REVIEWED');

        $clientRequestId = (string) Str::uuid();
        $request = ['destinationId' => $destinationId, 'clientRequestId' => $clientRequestId, 'currency' => 'PHP'];
        $payoutId = $this->withToken($providerToken)->postJson('/api/v1/provider/payouts', $request)
            ->assertOk()->assertJsonPath('data.status', 'REQUESTED')
            ->assertJsonPath('data.netDisbursementCentavos', 100000)->json('data.id');
        $this->withToken($providerToken)->postJson('/api/v1/provider/payouts', $request)
            ->assertOk()->assertJsonPath('data.id', $payoutId);
        $this->assertSame(1, DB::table('ProviderPayout')->count());
        $this->assertSame('PAYOUT_PROCESSING', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->withToken($otherProviderToken)->postJson("/api/v1/provider/payouts/{$payoutId}/cancel", ['confirmation' => 'CONFIRM'])
            ->assertNotFound();

        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/{$payoutId}/approve", [
            'note' => 'Payout amount and destination evidence were reviewed.',
        ])->assertOk()->assertJsonPath('data.status', 'APPROVED');
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/{$payoutId}/manual-processing", [
            'note' => 'Administrator is now completing the external transfer manually.',
            'confirmation' => 'MANUAL SETTLEMENT',
        ])->assertOk()->assertJsonPath('data.status', 'PROCESSING');
        $settlement = [
            'amountCentavos' => 100000, 'manualReference' => 'GCASH-SETTLEMENT-1001',
            'settledAt' => now()->toISOString(),
            'note' => 'GCash transfer receipt and recipient confirmation were verified.',
            'confirmation' => 'MANUAL SETTLEMENT CONFIRMED',
        ];
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/{$payoutId}/manual-settle", $settlement)
            ->assertOk()->assertJsonPath('data.status', 'PAID')
            ->assertJsonPath('data.manualSettlementReference', 'GCASH-SETTLEMENT-1001');
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/{$payoutId}/manual-settle", $settlement)
            ->assertOk()->assertJsonPath('data.status', 'PAID');
        $this->assertSame('PAID_OUT', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(1, DB::table('ProviderEarningLedgerEntry')->where('providerEarningId', $earningId)
            ->where('type', 'EARNING_PAID_OUT')->count());
        $this->assertSame(4, DB::table('ProviderPayoutAudit')->where('payoutId', $payoutId)->count());
        $this->withToken($providerToken)->getJson('/api/v1/provider/earnings/summary')->assertOk()
            ->assertJsonPath('data.0.paidOutCentavos', 100000)->assertJsonPath('data.0.withdrawableCentavos', 0);
    }

    public function test_cancelled_and_rejected_payouts_release_the_exact_reserved_earning(): void
    {
        [, $clientToken] = $this->user('release-client@example.com', 'Release Client', ['CLIENT']);
        [$provider, $providerToken] = $this->user('release-provider@example.com', 'Release Provider', ['PROVIDER']);
        [, $adminToken] = $this->user('release-admin@example.com', 'Release Admin', ['ADMIN']);
        $orderId = $this->createOrder($clientToken, $this->fixedService($provider->id), 'Test release of a cancelled payout reservation.');
        $earningId = (string) Str::uuid();
        DB::table('ProviderEarning')->insert([
            'id' => $earningId, 'providerId' => $provider->id, 'orderId' => $orderId,
            'sourceType' => 'ORIGINAL_ORDER', 'currency' => 'PHP', 'grossServiceAmountCentavos' => 50000,
            'status' => 'AVAILABLE', 'pendingAt' => now()->subDays(3), 'availableAt' => now()->subDays(2),
            'createdAt' => now()->subDays(3), 'updatedAt' => now()->subDays(2),
        ]);
        DB::table('ProviderEarningLedgerEntry')->insert([
            [
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
                'orderId' => $orderId, 'type' => 'EARNING_PENDING_CREDIT', 'amountCentavos' => 50000,
                'currency' => 'PHP', 'sourceKey' => 'release-credit', 'createdAt' => now()->subDays(3),
            ],
            [
                'id' => (string) Str::uuid(), 'providerEarningId' => $earningId, 'providerId' => $provider->id,
                'orderId' => $orderId, 'type' => 'EARNING_AVAILABLE_RELEASE', 'amountCentavos' => 0,
                'currency' => 'PHP', 'sourceKey' => 'release-available', 'createdAt' => now()->subDays(2),
            ],
        ]);
        $destinationId = $this->withToken($providerToken)->postJson('/api/v1/provider/payouts/destinations', [
            'type' => 'BANK_ACCOUNT', 'displayLabel' => 'Primary bank',
            'accountIdentifier' => '1234567890', 'accountHolderName' => 'Release Provider',
        ])->assertOk()->json('data.id');
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/destinations/{$destinationId}/review", [
            'note' => 'Bank destination ownership evidence was reviewed and accepted.',
        ])->assertOk();

        $first = $this->withToken($providerToken)->postJson('/api/v1/provider/payouts', [
            'destinationId' => $destinationId, 'clientRequestId' => (string) Str::uuid(), 'currency' => 'PHP',
        ])->assertOk()->json('data.id');
        $this->withToken($providerToken)->postJson("/api/v1/provider/payouts/{$first}/cancel", ['confirmation' => 'CONFIRM'])
            ->assertOk()->assertJsonPath('data.status', 'CANCELLED')
            ->assertJsonPath('data.items.0.reservationActive', false);
        $this->assertSame('AVAILABLE', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));

        $second = $this->withToken($providerToken)->postJson('/api/v1/provider/payouts', [
            'destinationId' => $destinationId, 'clientRequestId' => (string) Str::uuid(), 'currency' => 'PHP',
        ])->assertOk()->json('data.id');
        $this->withToken($adminToken)->postJson("/api/v1/admin/payouts/{$second}/reject", [
            'note' => 'Settlement cannot proceed because current evidence needs renewal.',
        ])->assertOk()->assertJsonPath('data.status', 'REJECTED')
            ->assertJsonPath('data.items.0.reservationActive', false);
        $this->assertSame('AVAILABLE', DB::table('ProviderEarning')->where('id', $earningId)->value('status'));
        $this->assertSame(2, DB::table('ProviderEarningLedgerEntry')->where('providerEarningId', $earningId)
            ->where('type', 'EARNING_PAYOUT_RELEASED')->count());
        $this->assertSame(2, DB::table('ProviderPayout')->count());
    }

    public function test_notifications_and_support_tickets_are_private_idempotent_and_rate_limited(): void
    {
        [$user, $token] = $this->user('support-user@example.com', 'Support User', ['CLIENT']);
        [$other, $otherToken] = $this->user('support-other@example.com', 'Other User', ['CLIENT']);
        $firstId = (string) Str::uuid();
        DB::table('Notification')->insert([
            [
                'id' => $firstId, 'recipientId' => $user->id, 'type' => 'ACCOUNT_NOTICE',
                'title' => 'First notice', 'body' => 'Read this account notice.', 'createdAt' => now()->subMinute(),
            ],
            [
                'id' => (string) Str::uuid(), 'recipientId' => $user->id, 'type' => 'ACCOUNT_NOTICE',
                'title' => 'Second notice', 'body' => 'Read this second notice.', 'createdAt' => now(),
            ],
            [
                'id' => (string) Str::uuid(), 'recipientId' => $other->id, 'type' => 'PRIVATE_NOTICE',
                'title' => 'Other notice', 'body' => 'This belongs to another account.', 'createdAt' => now(),
            ],
        ]);

        $this->withToken($token)->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonCount(2, 'data')->assertJsonPath('unreadCount', 2)
            ->assertJsonPath('data.0.title', 'Second notice');
        $this->withToken($otherToken)->patchJson("/api/v1/notifications/{$firstId}/read")->assertNotFound();
        $this->withToken($token)->patchJson("/api/v1/notifications/{$firstId}/read")->assertOk()
            ->assertJsonPath('data.id', $firstId)->assertJsonPath('data.readAt', fn (mixed $value): bool => is_string($value));
        $this->withToken($token)->patchJson("/api/v1/notifications/{$firstId}/read")->assertOk();
        $this->withToken($token)->patchJson('/api/v1/notifications/read-all')->assertOk()
            ->assertJsonPath('updated', 1)->assertJsonPath('message', '1 notification marked as read.');
        $this->withToken($token)->patchJson('/api/v1/notifications/read-all')->assertOk()
            ->assertJsonPath('updated', 0)->assertJsonPath('message', 'All notifications were already read.');

        for ($index = 1; $index <= 5; $index++) {
            $this->withToken($token)->postJson('/api/v1/support/tickets', [
                'category' => 'TECHNICAL', 'subject' => "Mobile issue {$index}",
                'message' => "The mobile application issue {$index} includes enough details for support.",
                'source' => 'MOBILE',
            ])->assertOk()->assertJsonPath('data.status', 'OPEN')
                ->assertJsonPath('reference', fn (mixed $value): bool => is_string($value) && str_starts_with($value, 'CG-SUPPORT-'));
        }
        $this->withToken($token)->postJson('/api/v1/support/tickets', [
            'category' => 'TECHNICAL', 'subject' => 'One request too many',
            'message' => 'This sixth support request must be rejected by the hourly safety limit.', 'source' => 'MOBILE',
        ])->assertStatus(429)->assertJsonPath('statusCode', 429);
        $this->withToken($token)->getJson('/api/v1/support/tickets/mine')->assertOk()
            ->assertJsonCount(5, 'data')->assertJsonFragment(['subject' => 'Mobile issue 5']);
        $this->withToken($otherToken)->getJson('/api/v1/support/tickets/mine')->assertOk()->assertJsonCount(0, 'data');
    }

    private function createOrder(string $token, string $serviceId, string $requirements): string
    {
        return $this->withToken($token)->postJson('/api/v1/orders', [
            'serviceId' => $serviceId, 'deliveryOption' => 'NORMAL', 'requirements' => $requirements,
        ])->assertCreated()->json('data.id');
    }

    private function fixedService(string $providerId): string
    {
        DB::table('ProviderProfile')->insert([
            'userId' => $providerId, 'isAvailable' => true, 'maxActiveOrders' => 5, 'maxPendingOrders' => 50,
        ]);
        DB::table('StudentProfile')->insert(['userId' => $providerId]);
        $id = (string) Str::uuid();
        DB::table('Service')->insert([
            'id' => $id, 'providerId' => $providerId, 'title' => 'Mobile Application', 'status' => 'PUBLISHED',
            'pricingModel' => 'SINGLE_PRICE_V2', 'basePriceCentavos' => 100000, 'normalDeliveryMinutes' => 4320,
            'includedRevisionLimit' => 1, 'acceptsRushOrders' => true, 'fastestRushTier' => 'HOURS_6',
        ]);

        return $id;
    }

    private function pdf(string $name, string $body): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "%PDF-1.4\n{$body}\n%%EOF");
    }

    private function user(string $email, string $name, array $roles): array
    {
        $user = User::query()->create([
            'email' => $email, 'displayName' => $name, 'passwordHash' => 'unused',
            'status' => 'ACTIVE', 'emailVerifiedAt' => now(),
            'mfaEnabledAt' => array_intersect(['ADMIN', 'SCHOOL_ADMIN'], $roles) !== [] ? now() : null,
            'sessionVersion' => 0,
        ]);
        foreach ($roles as $role) {
            UserRoleAssignment::query()->create(['userId' => $user->id, 'role' => $role]);
        }
        $session = AuthSession::query()->create([
            'id' => (string) Str::uuid(), 'userId' => $user->id, 'clientType' => 'MOBILE', 'deviceName' => 'Test',
            'sessionVersion' => 0, 'expiresAt' => now()->addDay(), 'lastUsedAt' => now(),
        ]);
        $token = app(TokenCodec::class)->issue([
            'sub' => $user->id, 'email' => $user->email, 'roles' => $roles, 'sessionVersion' => 0, 'sid' => $session->id,
        ]);

        return [$user, $token];
    }
}
