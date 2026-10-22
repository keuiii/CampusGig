# CampusGig mobile-first product strategy

CampusGig's primary mobile job is to help a student find a trustworthy provider, complete a small transaction, and recover safely from interruptions. Features should optimize for one-handed use, intermittent campus connectivity, low-cost devices, and short sessions without weakening payment or identity guarantees.

## Product principles

- Put one primary action in the thumb zone per screen. Secondary actions belong in menus, sheets, or clearly separated buttons.
- Preserve user input locally before network requests. Never lose a request, message draft, revision note, review, or profile edit when the app backgrounds.
- Treat realtime events as hints. On reconnect or foreground, reconcile authoritative API state using version or `updatedAt` cursors.
- Use optimistic UI only for reversible presentation state such as favorites or local conversation preferences. Payment, order transitions, delivery acceptance, reviews, verification, and moderation remain server-confirmed.
- Keep prices, due dates, provider identity, school, rating count, and order number visible near every consequential action.
- Use semantic vector icons, text labels for uncommon actions, 44–48 dp touch targets, screen-reader descriptions, dynamic text support, and reduced-motion behavior.
- Deep links must restore the exact service, provider, conversation, order, payment return, or notification destination after authentication.

## Now: finish the reliable marketplace core

### 1. Saved services and providers

Add authenticated favorites shared across web and mobile. The phone may optimistically toggle a heart and queue one retry, while the API remains authoritative.

Suggested record:

```text
Favorite(userId, serviceId, createdAt)
unique(userId, serviceId)
```

Acceptance criteria:

- Repeated taps and retries cannot create duplicates.
- Removed, rejected, paused, or archived services remain absent from discovery and are clearly unavailable in saved items.
- A web change appears after mobile reconnect/refresh and vice versa.

### 2. Search, filters, sorting, and pagination

Use a bottom sheet on mobile for school, category, price range, rating, and maximum delivery time. Keep the active filter count on the Discover toolbar and show removable filter chips above results. Sort options should be Relevance, Rating, Price low to high, Price high to low, and Fastest delivery.

Use cursor pagination instead of page numbers. The cursor must include the stable sort tie-breaker so new listings do not duplicate or skip existing results. Cancel stale searches and debounce text input by roughly 250–350 ms.

Acceptance criteria:

- Back navigation restores query, filters, loaded results, and scroll position.
- Empty, offline, loading, retry, and end-of-results states are distinct.
- Price, rating count, school, delivery, category, verified status, and availability are readable without opening a card.

### 3. Listing preview, pause, and archive

Providers need an exact client-view preview before moderation submission. Pause temporarily removes a published listing while preserving reviews and URLs. Archive is a reversible lifecycle state for listings with history; it must not delete order records or files.

Use explicit API transitions and version checks rather than a generic status update. Prevent pause/archive changes while a conflicting moderation request is being processed.

### 4. Push notifications and notification preferences

Add FCM for Android and APNs for iOS behind a device-registration API. Notifications should contain only opaque IDs and safe summaries; fetch protected details after the app opens. Support per-category preferences for messages, order changes, delivery, payment, review, verification, and promotions.

Persist device registrations by user and installation, rotate tokens, remove invalid tokens, and never use a push receipt as proof that a user saw an event. The in-app notification record remains authoritative.

### 5. Draft recovery and network resilience

Persist non-sensitive drafts with timestamps: booking requirements, messages, revision requests, reviews, provider profile changes, and support reports. Encrypt drafts that may contain personal or order information. Clear them only after the server confirms success or the user discards them.

Show `Waiting for connection`, `Sending`, `Sent`, and `Failed - tap to retry` states. Use idempotency keys for retried writes. Do not silently replay a payment, delivery acceptance, cancellation, or review without renewed user intent.

## Next: strengthen campus trust and repeat use

### 6. Availability calendar and realistic due dates

Let providers define weekly capacity, blackout dates, and maximum concurrent work. The API calculates the earliest date; clients cannot override it with a stale local calendar. Display campus timezone and explain why a date is unavailable.

### 7. Pre-order inquiry

Offer a structured in-app inquiry from the public provider profile before a request: service, short question, and optional reference attachment. Rate-limit new inquiries, provide block/report controls, and automatically close spam. Keep order conversations separate so inquiries cannot impersonate paid work.

Public social links may remain visible, but show a safety notice that CampusGig cannot protect off-platform payments or conversations. Never imply that off-platform contact is covered by the order dispute process.

### 8. Quick rebook and reusable briefs

After a completed order, let clients reuse the service/package and copy their own requirements into a new draft. Re-fetch current price, package contents, provider availability, and delivery estimate; never reuse an old commercial quote.

### 9. Campus-aware discovery without invasive tracking

Default to the user's verified/preferred school and let them expand to all participating schools. If distance becomes useful, request coarse location only at the moment it adds value and provide a manual campus selector. Do not continuously track background location.

### 10. Trust and safety center

Combine support references, disputes, blocked users, reported content, safety guidance, and emergency resources in Profile. A safety report should have a distinct urgent path, preserve evidence, restrict staff access, and never be mixed into public reviews.

## Later: scale engagement carefully

- Provider availability waitlists and service-restock alerts.
- Campus organization accounts and team purchasing with approval limits.
- Portfolio media optimization and resumable uploads for large files.
- Personalized recommendations only after enough interaction data exists; always retain deterministic filters and explain sponsored placements.
- Provider insights for impressions, saves, inquiries, conversion, repeat clients, on-time delivery, revisions, and rating trends.
- Optional passkey authentication after current email/password, Google, session, and MFA flows are stable across devices.

## Mobile performance budgets

- Cold launch to usable cached shell: target under 2.5 seconds on a mid-range Android device.
- Input response and navigation feedback: target under 100 ms.
- Avoid loading full-resolution images into memory. Generate server thumbnails, decode to displayed dimensions, cancel off-screen work, and dispose streams promptly.
- Keep initial Discover payload compact and paginate media-heavy lists.
- Cache public discovery data with bounded size and age; never cache private files outside protected app storage.
- Measure crashes, application-not-responding events, startup duration, API latency, image memory, failed uploads, reconnects, and battery/network use by app version and device class.

## Delivery sequence and success measures

Recommended implementation order:

1. Cursor pagination plus filter/sort API contracts.
2. Favorites with cross-client realtime invalidation and reconnect reconciliation.
3. Listing preview/pause/archive.
4. Draft recovery and idempotent retry UX.
5. Push registration and preference controls.
6. Pre-order inquiry with moderation controls.
7. Availability calendar and quick rebook.

Release each feature behind a server-controlled flag and track crash-free sessions, failed-write rate, search-to-service-view rate, request completion rate, payment completion rate, on-time delivery, dispute rate, repeat booking, and notification opt-out rate. A feature is not complete until it works after background/resume, offline/reconnect, token refresh, duplicate tap, and app restart on the Android emulator and a physical Android device. iPhone certification requires a connected Mac build host and a physical or hosted iOS test device.

## Immediate UI recommendations

- Keep the Discover greeting compact so results appear above the fold on smaller phones.
- Use a sticky search/filter row after the hero scrolls away; do not replay or reset the list while the user is scrolling.
- Limit service cards to one prominent price, one rating line with review count, and two or three high-value metadata chips.
- Use skeletons only for the shape of incoming content; use explicit progress for uploads and payments.
- Keep provider identity and order number in a persistent workspace header, matching the strengthened Orders hierarchy.
- Use confirmation sheets for destructive or financial actions and short inline feedback for reversible actions.
- Keep the neutral zero-unread badge and light-green active badge already established; do not use alert red for ordinary unread state.
