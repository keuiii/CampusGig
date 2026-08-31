# CampusGig Development Roadmap

Last updated: August 30, 2026

Related documentation: [project setup and current API status](./README.md) and [mobile source-code guide](./mobile/SOURCE_CODE_GUIDE.md).

## Current status

CampusGig is in the **integrated MVP development stage**. The web and Expo mobile apps use the NestJS API and PostgreSQL database for authentication, profiles, school verification, moderated service listings, marketplace discovery, full fixed-price order lifecycle actions, private order messaging, deliverables, revisions, notifications, and verified reviews. Disputes and payments are not yet operational.

Estimated progress:

- **Phase 1 MVP:** approximately 78% complete
- **Full production platform:** approximately 30% complete

These percentages measure working end-to-end functionality, not only screens or database tables.

## Progress completed so far

### Project foundation — Complete

- Next.js web application created
- Expo React Native mobile application created and tested on Android emulator
- NestJS REST API created under `/api/v1`
- Prisma ORM and PostgreSQL schema prepared
- Docker Compose configuration prepared for local PostgreSQL
- Swagger API documentation configured
- npm-based start and build commands configured
- Web, API, and mobile TypeScript builds validated

### Database design — Designed and partially integrated

The Prisma schema already covers:

- Users and multiple role assignments
- Client-only accounts and optional Student Client registration
- Schools and student profiles
- Student-verification requests
- Service categories, services, and package tiers
- Orders and order-status history
- Order files and deliverables
- Order-linked conversations and messages
- Revision requests
- Ratings and reviews

Only the approved service categories are seeded. There are no fabricated users, schools, services, orders, or reviews.

### Marketplace discovery — Core flow complete

- Category browsing
- Service search interface
- Service cards and service-detail interface
- Package-selection interface
- Active-school discovery API
- Preferred-school filtering on web and mobile
- Clean loading and empty states

Remaining: price/rating/delivery filters, pagination, sorting, favorites, and production-grade search.

### Provider workspace — Core listing and request flow complete

- Verified-provider web sign-in and session restoration
- Persisted provider headline, bio, skill list, and availability
- Real service draft creation using the approved categories
- Persisted Basic, Standard, and Premium package options
- Cover and portfolio uploads using private local development storage
- Provider listing status view and submission to `PENDING_REVIEW`
- Administrator listing moderation and publication
- Client request list with provider accept/reject actions
- Durable provider notifications and unread counts
- Verified-provider authorization enforced by the API

Remaining: listing preview/pause/archive and production object storage. Provider order workspaces, timelines, messaging, and delivery submission are connected.

### Dashboard interfaces — Partially connected

- Provider dashboard layout
- Admin dashboard layout
- Orders interface
- Verification queue interface
- Profile setup interface
- Mobile Orders, Messages, and Profile navigation

Administrator verification and school management, provider profiles/listings/moderation requests, order requests, notifications, lifecycle-focused order workspaces, dedicated mobile conversations, delivery/revision/completion transitions, and reviews use authenticated database operations. Disputes and some secondary empty states remain prototypes.

### Participating schools and verification — Backend and mobile flow complete

- Admin-only participating-school list, creation, and status endpoints
- Role guards for admin and provider API areas
- Authenticated student profile read/update endpoints
- Mobile school, program, year-level, and bio profile form
- Private JPG, PNG, and PDF student-ID upload with a 5 MB limit
- Persisted verification queue and authenticated status tracking
- Admin-only document viewing, approval, and rejection with required reasons
- Approved students automatically receive provider eligibility
- Web administrator session restoration through the unified account flow
- Unified web login/sign-up with automatic role-based routing
- Connected school-management and student-verification dashboard
- Live administrator statistics from PostgreSQL
- No invented schools: the mobile app shows an honest empty state until an administrator adds a real participating school
- Platform administrators can assign an existing verified account as a school administrator
- School administrators receive a private dashboard limited to verification requests and documents from their assigned school
- School-level access is isolated from platform statistics, service moderation, and school management

## Phase 1 MVP roadmap

### Milestone 1 — Local environment and database

Goal: make the backend persist and retrieve real development data.

Progress: **complete for local development.** Docker Desktop is running PostgreSQL 17, the initial migration is applied, and the clean seed contains six categories with no fabricated marketplace records.

- Start PostgreSQL locally using Docker or a local PostgreSQL installation
- Configure `DATABASE_URL`
- Run Prisma migrations
- Seed only the approved categories
- Admin-controlled participating-school endpoints implemented
- Confirm the web and mobile apps can reach the API
- Add environment setup documentation

Definition of done: categories and approved schools survive application restarts and are returned by the API.

### Milestone 2 — Authentication and authorization

Goal: replace the anonymous prototype with real accounts and protected roles.

Progress: **backend, web, and mobile authentication are implemented, including new-account email codes, password recovery, authenticated password changes, and a secure Google ID-token/account-linking foundation. Existing accounts were safely grandfathered as verified. Google OAuth credentials, production email-provider configuration, refresh sessions, and endpoint-by-endpoint authorization hardening remain deployment setup work.**

- Local email/password authentication selected for the MVP backend
- Registration, login, password hashing, JWT issuance, and `/auth/me` implemented
- Google social sign-in implemented for web and mobile with backend token verification, persistent social-account links, and configuration-aware disabled states
- Mobile persistent login and logout implemented
- Persistent animated night-mode controls implemented for mobile and web, including dark cards, forms, navigation, and status-bar treatment
- Web-wide motion system implemented for navigation, scrolling, cards, forms, dropdowns, page transitions, and accessibility preferences
- Mobile Profile next steps now include real provider-profile editing and account security settings
- Web and mobile profile pictures are stored by the API and refreshed across account and profile icons
- Initial Prisma migration applied and real `User` creation verified
- Web authentication and forgot/reset-password flow implemented; refresh-token rotation remains
- Role-based guard infrastructure added for Student, Provider, Organization, and Admin
- Admin, provider, order, school-administration, and student-profile routes protected
- Add route protection to web and mobile screens
- Add account suspension and deactivation handling

Definition of done: users can securely sign in and can access only actions allowed for their roles.

### Milestone 3 — Student profiles and school verification

Goal: allow CampusGig to verify that a user belongs to a participating school.

Progress: **profile setup, identity-document submission, backend approval, and the admin web review UI are complete; production object storage remains.**

- Student profile creation and editing implemented in the API and mobile app
- School selection, program, and year level implemented
- School-email verification where supported
- Student-ID upload to private local storage implemented for development
- Verification-request submission implemented in mobile and API
- Admin approve/reject API flow implemented with rejection reason
- Verified status and provider eligibility rules implemented
- Privacy rules for student numbers and uploaded IDs

Definition of done: an admin can approve a real student, and only verified students can publish services or accept jobs.

### Milestone 4 — Provider services

Goal: let verified providers manage real Fiverr-style listings.

Progress: **provider profile, listing creation and editing, Basic/Standard/Premium packages, private cover/portfolio uploads, moderation submission, administrator approval/publishing, rejection feedback, and the web moderation queue are implemented. Production object storage remains.**

- Create and edit draft/rejected services — implemented; preview, pause, and archive remain
- Add Basic, Standard, and Premium packages — implemented
- Upload service cover images and portfolio files — implemented with private local development storage; production object storage remains
- Submit listings for moderation
- Admin listing approval or rejection — implemented
- Public service detail endpoint
- Category, school, price, rating, and delivery filters
- Pagination and sorting

Definition of done: a verified provider can publish a moderated service that clients can discover and filter by school.

### Milestone 5 — Orders and lifecycle tracking

Goal: complete the first end-to-end marketplace transaction without online payment.

Progress: **client package selection, requirement capture, transactional order creation, immutable snapshots, status history, automatic conversations, mobile client order workspaces, provider decisions, delivery uploads, revision requests/resubmission, completion, and lifecycle notifications are implemented.**

- Create an order from a selected service package — complete
- Capture client requirements and due date — complete
- Provider accept or reject actions — complete
- Enforce valid status transitions
- Start work — complete
- Submit deliverable, request revision, resubmit, and complete — complete
- Store an immutable service/package snapshot on every order — complete
- Add order timeline and status history — complete
- Implement client and provider order lists and detail screens — mobile client and web provider workspaces complete
- Add cancellation rules

Definition of done: two authenticated users can complete the full order lifecycle with persisted history.

### Milestone 6 — Messaging and file sharing

Goal: support safe collaboration tied to a real order.

- Automatically create one conversation per order — complete
- Send and retrieve participant-only persisted messages — complete on mobile client and provider web workspaces
- Order detail workspace and persisted status timeline — complete on mobile client and provider web
- Real-time updates using WebSockets or a managed realtime service
- Read status and unread counts
- Upload requirements, attachments, and deliverables — deliverables and message attachments complete
- Private signed file URLs
- File type, size, and malware-safety validation
- Prevent users outside the order from accessing messages or files

Definition of done: only the order’s client and provider can exchange messages and private files.

### Milestone 7 — Reviews, revisions, and basic disputes

Goal: establish marketplace trust and finish the MVP lifecycle.

- Enforce package revision limits — complete
- Revision instructions and resolution tracking
- One review per completed order — complete
- Rating validation and aggregate recalculation
- Provider rating display
- Basic report/dispute submission
- Admin dispute review and audit notes

Definition of done: completed orders can produce verified reviews, and revision/dispute events are traceable.

### Milestone 8 — Admin operations

Goal: give administrators enough control to safely operate the MVP.

- Real dashboard statistics
- Manage schools and categories
- Review student-verification requests
- Moderate services
- Search and manage users
- Suspend accounts and record reasons
- Review reported orders or disputes
- Audit log for sensitive admin actions

Definition of done: normal MVP operations no longer require direct database editing.

### Milestone 9 — Quality assurance and MVP release

Goal: make the system demonstrable and deployable.

- Unit tests for permissions and order-state rules
- API integration tests
- End-to-end tests for registration, verification, listing, order, and review
- Form validation and friendly error handling
- Loading, offline, retry, and empty states
- Accessibility and responsive-layout review
- Security review for authorization and file access
- Database backup and restore procedure
- Deploy database, API, web app, and file storage
- Produce an Android test build
- Add privacy policy, terms, community rules, and support contact

Definition of done: the primary MVP flow passes tests in a deployed staging environment.

## Phase 2 — Dual marketplace and monetization

Begin this only after the fixed-price Phase 1 flow is stable.

- Custom job postings
- Provider proposals and proposal comparison
- Client-provider contract creation
- School-organization accounts and organization workflows
- Online payments and payout onboarding
- Platform commission fees
- Refund and payment-dispute handling
- Pro provider subscriptions
- Featured listings
- Saved services and notifications
- Advanced analytics and reporting

## Phase 3 — Production growth

- iOS and Play Store release processes
- Multi-school onboarding portal
- Recommendation and ranking system
- Content moderation and fraud detection
- Observability, alerts, and performance monitoring
- Data-retention and account-deletion workflows
- Scalable search service if database search becomes insufficient
- Financial reconciliation and regulatory review

## Recommended implementation order

The critical path is:

`Database → Authentication → Verification → Service publishing → Orders → Messaging/files → Reviews → Admin hardening → Testing/deployment`

Payments, proposals, Pro subscriptions, and featured listings should not be developed before the core order workflow is secure and reliable.

## Suggested next four sprints

Assuming one- or two-week student sprints:

1. **Sprint 1:** PostgreSQL, initial migration, authentication API, and mobile authentication — substantially complete; finish web auth and authorization.
2. **Sprint 2:** student profiles, participating-school administration, private student-ID submission, and web verification review complete; production object storage remains.
3. **Sprint 3:** provider service CRUD, package CRUD, service moderation, and real marketplace filtering.
4. **Sprint 4:** order creation, lifecycle transitions, order detail screens, and status history.

Messaging, uploads, reviews, disputes, automated tests, and deployment follow in later sprints.

## Best next task

The next development task should be **basic dispute handling**, followed by automated order-state and permission tests.
