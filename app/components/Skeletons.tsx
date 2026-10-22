type SkeletonKind =
  | "service"
  | "conversation"
  | "order"
  | "profile"
  | "listing"
  | "review"
  | "admin";

export function isInitialContentLoad(loading: boolean, contentCount: number) {
  return loading && contentCount === 0;
}

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span className={`skeleton-block ${className}`} aria-hidden="true" />;
}

export function SkeletonCard({ kind }: { kind: SkeletonKind }) {
  return (
    <div className={`skeleton-card skeleton-card-${kind}`} aria-hidden="true">
      {kind === "service" && <SkeletonBlock className="skeleton-cover" />}
      {(kind === "conversation" || kind === "order" || kind === "profile") && (
        <SkeletonBlock className="skeleton-avatar" />
      )}
      <div className="skeleton-lines">
        <SkeletonBlock className="skeleton-line skeleton-line-title" />
        <SkeletonBlock className="skeleton-line skeleton-line-wide" />
        <SkeletonBlock className="skeleton-line skeleton-line-short" />
        {(kind === "order" || kind === "admin") && (
          <SkeletonBlock className="skeleton-line skeleton-line-footer" />
        )}
      </div>
    </div>
  );
}

export function SkeletonCollection({
  kind,
  count = 3,
  label,
  className = "",
}: {
  kind: SkeletonKind;
  count?: number;
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`skeleton-collection skeleton-collection-${kind} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard kind={kind} key={index} />
      ))}
    </div>
  );
}
