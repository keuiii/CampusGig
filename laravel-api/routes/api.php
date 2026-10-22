<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AdminDisputesController;
use App\Http\Controllers\AdminPayoutsController;
use App\Http\Controllers\AdminRefundsController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DisputesController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\MarketplaceReferenceController;
use App\Http\Controllers\MessagesController;
use App\Http\Controllers\MetricsController;
use App\Http\Controllers\NotificationsController;
use App\Http\Controllers\OrdersController;
use App\Http\Controllers\PaymentsController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProviderController;
use App\Http\Controllers\ProviderEarningsController;
use App\Http\Controllers\ProviderPayoutsController;
use App\Http\Controllers\PublicProviderController;
use App\Http\Controllers\ServicesController;
use App\Http\Controllers\SupportController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [HealthController::class, 'health']);
Route::get('/health/ready', [HealthController::class, 'ready']);
Route::get('/metrics', MetricsController::class)->middleware('metrics.access');
Route::get('/categories', [MarketplaceReferenceController::class, 'categories']);
Route::get('/schools', [MarketplaceReferenceController::class, 'schools']);
Route::get('/providers/{id}/public', [PublicProviderController::class, 'profile']);
Route::get('/providers/{id}/reviews', [PublicProviderController::class, 'reviews']);
Route::get('/services', [ServicesController::class, 'index']);
Route::get('/services/saved/ids', [ServicesController::class, 'savedIds'])->middleware('access.token');
Route::get('/services/saved', [ServicesController::class, 'saved'])->middleware('access.token');
Route::put('/services/{id}/save', [ServicesController::class, 'save'])->middleware('access.token');
Route::delete('/services/{id}/save', [ServicesController::class, 'unsave'])->middleware('access.token');
Route::post('/services/{id}/quote', [ServicesController::class, 'quote'])->middleware('access.token');
Route::get('/services/{id}/media/{mediaId}', [ServicesController::class, 'media']);
Route::get('/services/{id}', [ServicesController::class, 'show']);
Route::get('/payments/mobile-return', [PaymentsController::class, 'mobileReturn']);
Route::post('/payments/paymongo/webhook', [PaymentsController::class, 'webhook']);
Route::get('/profile/avatar/{userId}', [ProfileController::class, 'avatar']);

Route::post('/profile/avatar', [ProfileController::class, 'uploadAvatar'])->middleware('access.token');
Route::prefix('profile/student')->middleware(['access.token', 'role:STUDENT'])->group(function (): void {
    Route::get('/', [ProfileController::class, 'student']);
    Route::put('/', [ProfileController::class, 'updateStudent']);
    Route::get('/verification', [ProfileController::class, 'verification']);
    Route::post('/verification', [ProfileController::class, 'submitVerification']);
});

Route::prefix('admin')->middleware(['access.token', 'role:ADMIN,SCHOOL_ADMIN'])->group(function (): void {
    Route::get('/verifications', [AdminController::class, 'verifications']);
    Route::get('/verifications/{id}/document', [AdminController::class, 'document']);
    Route::post('/verifications/{id}/approve', [AdminController::class, 'approveVerification']);
    Route::post('/verifications/{id}/reject', [AdminController::class, 'rejectVerification']);
});

Route::prefix('admin')->middleware(['access.token', 'role:ADMIN'])->group(function (): void {
    Route::get('/dashboard', [AdminController::class, 'dashboard']);
    Route::get('/services', [AdminController::class, 'services']);
    Route::post('/services/{id}/approve', [AdminController::class, 'approveService']);
    Route::post('/services/{id}/reject', [AdminController::class, 'rejectService']);
    Route::get('/school-admins', [AdminController::class, 'schoolAdmins']);
    Route::post('/school-admins', [AdminController::class, 'assignSchoolAdmin']);
    Route::delete('/school-admins/{userId}', [AdminController::class, 'removeSchoolAdmin']);
});

Route::prefix('admin/schools')->middleware(['access.token', 'role:ADMIN'])->group(function (): void {
    Route::get('/', [MarketplaceReferenceController::class, 'adminSchools']);
    Route::post('/', [MarketplaceReferenceController::class, 'createSchool']);
    Route::patch('/{id}/status', [MarketplaceReferenceController::class, 'updateSchoolStatus']);
});

Route::prefix('admin/refunds')->middleware(['access.token', 'role:ADMIN'])->group(function (): void {
    Route::get('/', [AdminRefundsController::class, 'index']);
    Route::get('/stale-revisions', [AdminRefundsController::class, 'staleRevisions']);
    Route::post('/disputes/{disputeId}', [AdminRefundsController::class, 'fromDispute']);
    Route::post('/stale-revisions/{revisionPurchaseId}', [AdminRefundsController::class, 'staleRevision']);
    Route::post('/exceptions', [AdminRefundsController::class, 'exception']);
    Route::get('/{id}', [AdminRefundsController::class, 'detail']);
    Route::post('/{id}/reconcile', [AdminRefundsController::class, 'reconcile']);
});

Route::prefix('admin/disputes')->middleware(['access.token', 'role:ADMIN'])->group(function (): void {
    Route::get('/', [AdminDisputesController::class, 'index']);
    Route::get('/{id}', [AdminDisputesController::class, 'detail']);
    Route::get('/{id}/evidence/{evidenceId}', [AdminDisputesController::class, 'evidence']);
    Route::post('/{id}/request-response', [AdminDisputesController::class, 'requestResponse']);
    Route::post('/{id}/ready', [AdminDisputesController::class, 'ready']);
    Route::post('/{id}/review', [AdminDisputesController::class, 'review']);
    Route::post('/{id}/resolve', [AdminDisputesController::class, 'resolve']);
});

Route::prefix('admin/payouts')->middleware(['access.token', 'role:ADMIN'])->group(function (): void {
    Route::get('/', [AdminPayoutsController::class, 'index']);
    Route::get('/destinations', [AdminPayoutsController::class, 'destinations']);
    Route::post('/destinations/{destinationId}/review', [AdminPayoutsController::class, 'reviewDestination']);
    Route::get('/destinations/{destinationId}/sensitive-details', [AdminPayoutsController::class, 'sensitiveDestinationDetails']);
    Route::get('/{payoutId}', [AdminPayoutsController::class, 'detail']);
    Route::post('/{payoutId}/approve', [AdminPayoutsController::class, 'approve']);
    Route::post('/{payoutId}/reject', [AdminPayoutsController::class, 'reject']);
    Route::post('/{payoutId}/manual-processing', [AdminPayoutsController::class, 'beginManual']);
    Route::post('/{payoutId}/manual-settle', [AdminPayoutsController::class, 'settleManual']);
});

Route::prefix('provider')->middleware(['access.token', 'role:PROVIDER'])->group(function (): void {
    Route::get('/dashboard', [ProviderController::class, 'dashboard']);
    Route::get('/profile', [ProviderController::class, 'profile']);
    Route::put('/profile', [ProviderController::class, 'updateProfile']);
    Route::put('/availability', [ProviderController::class, 'updateAvailability']);
    Route::get('/services', [ProviderController::class, 'services']);
    Route::post('/services', [ProviderController::class, 'createService']);
    Route::put('/services/{id}', [ProviderController::class, 'updateService']);
    Route::post('/services/{id}/media', [ProviderController::class, 'uploadMedia']);
    Route::get('/services/{id}/media/{mediaId}', [ProviderController::class, 'ownedMedia']);
    Route::delete('/services/{id}/media/{mediaId}', [ProviderController::class, 'removeMedia']);
    Route::post('/services/{id}/submit', [ProviderController::class, 'submitService']);
    Route::post('/services/{id}/revise', [ProviderController::class, 'reviseService']);
    Route::post('/services/{id}/{action}', [ProviderController::class, 'transitionService'])
        ->whereIn('action', ['pause', 'resume', 'archive', 'restore']);
    Route::get('/earnings/summary', [ProviderEarningsController::class, 'summary']);
    Route::get('/earnings', [ProviderEarningsController::class, 'index']);
    Route::get('/payouts', [ProviderPayoutsController::class, 'index']);
    Route::get('/payouts/destinations', [ProviderPayoutsController::class, 'destinations']);
    Route::post('/payouts/destinations', [ProviderPayoutsController::class, 'createDestination']);
    Route::post('/payouts/destinations/{destinationId}/deactivate', [ProviderPayoutsController::class, 'deactivate']);
    Route::post('/payouts', [ProviderPayoutsController::class, 'requestPayout']);
    Route::post('/payouts/{payoutId}/cancel', [ProviderPayoutsController::class, 'cancel']);
});

Route::prefix('orders')->middleware('access.token')->group(function (): void {
    Route::get('/', [OrdersController::class, 'index']);
    Route::post('/', [OrdersController::class, 'create']);
    Route::get('/{id}', [OrdersController::class, 'show']);
    Route::post('/{id}/accept', [OrdersController::class, 'accept']);
    Route::post('/{id}/reject', [OrdersController::class, 'reject']);
    Route::post('/{id}/cancel', [OrdersController::class, 'cancel']);
    Route::post('/{id}/start', [OrdersController::class, 'start']);
    Route::post('/{id}/deliver', [OrdersController::class, 'deliver']);
    Route::get('/{id}/files/{fileId}', [OrdersController::class, 'file']);
    Route::post('/{id}/revision', [OrdersController::class, 'revision']);
    Route::post('/{id}/revisions/correction-claim', [OrdersController::class, 'correctionClaim']);
    Route::post('/{id}/revisions/{revisionId}/correction-decision', [OrdersController::class, 'correctionDecision']);
    Route::post('/{id}/complete', [OrdersController::class, 'complete']);
    Route::post('/{id}/review', [OrdersController::class, 'review']);
    Route::get('/{orderId}/messages', [MessagesController::class, 'orderMessages']);
    Route::post('/{orderId}/messages', [MessagesController::class, 'sendOrder']);
    Route::post('/{orderId}/messages/attachments', [MessagesController::class, 'attachments']);
    Route::get('/{orderId}/disputes', [DisputesController::class, 'index']);
    Route::post('/{orderId}/disputes', [DisputesController::class, 'open']);
    Route::post('/{orderId}/disputes/{disputeId}/responses', [DisputesController::class, 'respond']);
    Route::post('/{orderId}/disputes/{disputeId}/evidence', [DisputesController::class, 'evidence']);
    Route::get('/{orderId}/disputes/{disputeId}/evidence/{evidenceId}', [DisputesController::class, 'download']);
    Route::get('/{orderId}/payments', [PaymentsController::class, 'index']);
    Route::post('/{orderId}/payments/checkout', [PaymentsController::class, 'checkout']);
    Route::get('/{orderId}/payments/revision-quote', [PaymentsController::class, 'revisionQuote']);
    Route::post('/{orderId}/payments/revision-checkout', [PaymentsController::class, 'revisionCheckout']);
    Route::get('/{orderId}/payments/refund-eligibility', [PaymentsController::class, 'refundEligibility']);
    Route::post('/{orderId}/payments/refunds', [PaymentsController::class, 'requestRefund']);
    Route::post('/{id}/{action}', [OrdersController::class, 'visibility'])
        ->whereIn('action', ['archive', 'restore', 'remove']);
});

Route::prefix('conversations')->middleware('access.token')->group(function (): void {
    Route::get('/', [MessagesController::class, 'inbox']);
    Route::post('/inquiries', [MessagesController::class, 'inquiry']);
    Route::get('/{conversationId}/messages', [MessagesController::class, 'conversationMessages']);
    Route::post('/{conversationId}/messages', [MessagesController::class, 'sendConversation']);
    Route::patch('/{conversationId}/preferences', [MessagesController::class, 'preferences']);
    Route::delete('/{conversationId}', [MessagesController::class, 'hide']);
});

Route::prefix('notifications')->middleware('access.token')->group(function (): void {
    Route::get('/', [NotificationsController::class, 'index']);
    Route::patch('/read-all', [NotificationsController::class, 'markAllRead']);
    Route::patch('/{id}/read', [NotificationsController::class, 'markRead']);
});

Route::prefix('support/tickets')->middleware('access.token')->group(function (): void {
    Route::post('/', [SupportController::class, 'create']);
    Route::get('/mine', [SupportController::class, 'mine']);
});

Route::prefix('auth')->group(function (): void {
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/social', [AuthController::class, 'socialLogin']);
    Route::post('/verify-email', [AuthController::class, 'verifyEmail']);
    Route::post('/resend-verification', [AuthController::class, 'resendVerification']);
    Route::post('/forgot-password', [AuthController::class, 'forgotPassword']);
    Route::post('/reset-password', [AuthController::class, 'resetPassword']);
    Route::post('/mfa/challenge', [AuthController::class, 'verifyMfaChallenge']);
    Route::get('/password-change/review', [AuthController::class, 'passwordChangeReview']);
    Route::post('/password-change/decision', [AuthController::class, 'decidePasswordChange']);
    Route::post('/refresh', [AuthController::class, 'refresh']);
    Route::post('/logout', [AuthController::class, 'logout']);

    Route::middleware('access.token')->group(function (): void {
        Route::get('/me', [AuthController::class, 'me']);
        Route::get('/sessions', [AuthController::class, 'sessions']);
        Route::delete('/sessions/{id}', [AuthController::class, 'revokeSession']);
        Route::post('/logout-all', [AuthController::class, 'logoutAll']);
        Route::get('/mfa/status', [AuthController::class, 'mfaStatus']);
        Route::post('/mfa/setup', [AuthController::class, 'beginMfaSetup']);
        Route::post('/mfa/setup/confirm', [AuthController::class, 'confirmMfaSetup']);
        Route::post('/mfa/disable', [AuthController::class, 'disableMfa']);
        Route::post('/mfa/recovery-codes', [AuthController::class, 'regenerateRecoveryCodes']);
        Route::post('/mfa/trusted-devices/revoke', [AuthController::class, 'revokeTrustedDevices']);
        Route::post('/change-password', [AuthController::class, 'changePassword']);
        Route::get('/password-change/pending', [AuthController::class, 'pendingPasswordChange']);
        Route::get('/password-change/{id}/status', [AuthController::class, 'passwordChangeStatus']);
        Route::post('/password-change/{id}/cancel', [AuthController::class, 'cancelPasswordChange']);
    });
});
