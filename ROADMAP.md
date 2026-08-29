# CampusGig Development Roadmap

Last updated: August 29, 2026

Related documentation: [project setup and current API status](./README.md) and [mobile source-code guide](./mobile/SOURCE_CODE_GUIDE.md).

## Current status

CampusGig is in the **foundation and interactive-prototype stage**. The project has a working web interface, a working Expo mobile interface, a NestJS API foundation, and a PostgreSQL/Prisma data model. Marketplace discovery and preferred-school filtering are implemented structurally, but the complete authenticated order workflow is not yet operational.

Estimated progress:

- **Phase 1 MVP:** approximately 25% complete
- **Full production platform:** approximately 10–15% complete

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

### Database design — Designed, awaiting full integration

The Prisma schema already covers:

- Users and multiple role assignments
- Schools and student profiles
- Student-verification requests
- Service categories, services, and package tiers
- Orders and order-status history
- Order files and deliverables
- Order-linked conversations and messages
- Revision requests
- Ratings and reviews

Only the approved service categories are seeded. There are no fabricated users, schools, services, orders, or reviews.

### Marketplace discovery — Partially complete

- Category browsing
- Service search interface
- Service cards and service-detail interface
- Package-selection interface
- Active-school discovery API
- Preferred-school filtering on web and mobile
- Clean loading and empty states

Remaining: provider service creation, editing, publishing, real pagination, sorting, favorites, and production-grade search.

### Dashboard interfaces — Prototype complete

- Provider dashboard layout
- Admin dashboard layout
- Orders interface
- Verification queue interface
- Profile setup interface
- Mobile Orders, Messages, and Profile navigation

Dashboard values and actions are not yet fully connected to authenticated database operations.

## Phase 1 MVP roadmap

### Milestone 1 — Local environment and database

Goal: make the backend persist and retrieve real development data.

- Start PostgreSQL locally using Docker or a local PostgreSQL installation
- Configure `DATABASE_URL`
- Run Prisma migrations
- Seed only the approved categories
- Add an admin-controlled way to register participating schools
- Confirm the web and mobile apps can reach the API
- Add environment setup documentation

Definition of done: categories and approved schools survive application restarts and are returned by the API.

### Milestone 2 — Authentication and authorization

Goal: replace the anonymous prototype with real accounts and protected roles.

- Choose and configure authentication, preferably Supabase Auth or another managed provider
- Implement registration, login, logout, forgot-password, and session refresh
- Create or synchronize the local `User` record after registration
- Add role-based access control for Student, Provider, Organization, and Admin
- Protect API endpoints with authentication guards
- Add route protection to web and mobile screens
- Add account suspension and deactivation handling

Definition of done: users can securely sign in and can access only actions allowed for their roles.

### Milestone 3 — Student profiles and school verification

Goal: allow CampusGig to verify that a user belongs to a participating school.

- Student profile creation and editing
- School selection, program, and year level
- School-email verification where supported
- Student-ID upload to private storage
- Verification-request submission
- Admin approve/reject flow with rejection reason
- Verified badge and provider eligibility rules
- Privacy rules for student numbers and uploaded IDs

Definition of done: an admin can approve a real student, and only verified students can publish services or accept jobs.

### Milestone 4 — Provider services

Goal: let verified providers manage real Fiverr-style listings.

- Create, edit, preview, pause, and archive a service
- Add Basic, Standard, and Premium packages
- Upload service cover images and portfolio files
- Submit listings for moderation
- Admin listing approval or rejection
- Public service detail endpoint
- Category, school, price, rating, and delivery filters
- Pagination and sorting

Definition of done: a verified provider can publish a moderated service that clients can discover and filter by school.

### Milestone 5 — Orders and lifecycle tracking

Goal: complete the first end-to-end marketplace transaction without online payment.

- Create an order from a selected service package
- Capture client requirements and due date
- Provider accept or reject actions
- Enforce valid status transitions
- Start work, submit deliverable, request revision, resubmit, and complete
- Store an immutable service/package snapshot on every order
- Add order timeline and status history
- Implement client and provider order lists and detail screens
- Add cancellation rules

Definition of done: two authenticated users can complete the full order lifecycle with persisted history.

### Milestone 6 — Messaging and file sharing

Goal: support safe collaboration tied to a real order.

- Automatically create one conversation per order
- Send and retrieve messages
- Real-time updates using WebSockets or a managed realtime service
- Read status and unread counts
- Upload requirements, attachments, and deliverables
- Private signed file URLs
- File type, size, and malware-safety validation
- Prevent users outside the order from accessing messages or files

Definition of done: only the order’s client and provider can exchange messages and private files.

### Milestone 7 — Reviews, revisions, and basic disputes

Goal: establish marketplace trust and finish the MVP lifecycle.

- Enforce package revision limits
- Revision instructions and resolution tracking
- One review per completed order
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

1. **Sprint 1:** PostgreSQL setup, migrations, authentication, user synchronization, and protected API routes.
2. **Sprint 2:** student profiles, participating-school administration, student-ID storage, and verification approval.
3. **Sprint 3:** provider service CRUD, package CRUD, service moderation, and real marketplace filtering.
4. **Sprint 4:** order creation, lifecycle transitions, order detail screens, and status history.

Messaging, uploads, reviews, disputes, automated tests, and deployment follow in later sprints.

## Best next task

The next development task should be **Milestone 1 followed immediately by authentication**. Every later feature needs real users, roles, schools, and database persistence; building additional disconnected screens before these foundations would not produce a working marketplace.
