"use client";

/* eslint-disable @next/next/no-img-element -- Images use the runtime-configured CampusGig API origin. */
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { realtimeSocketEnabled } from "../realtime/realtime-config";
import { api } from "../../lib/api";
import { apiUrl } from "../../lib/http-client";
import { SkeletonCollection } from "../../components/Skeletons";
import type {
  PublicProviderProfile,
  PublicProviderReviews,
  Service,
} from "../../types";

export function PublicProviderProfileView({
  providerId,
  token,
  back,
  backLabel,
  openService,
}: {
  providerId: string;
  token?: string;
  back: () => void;
  backLabel: string;
  openService: (service: Service) => void;
}) {
  const [profile, setProfile] = useState<PublicProviderProfile | null>(null);
  const [error, setError] = useState("");
  const [reviewPage, setReviewPage] = useState(1);
  const [reviews, setReviews] = useState<PublicProviderReviews | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setProfile((current) => (current?.id === providerId ? current : null));
    setError("");
    void api
      .publicProvider(providerId)
      .then((response) => active && setProfile(response.data))
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to load this provider profile.",
          );
      });
    return () => {
      active = false;
    };
  }, [providerId, refreshVersion]);

  useEffect(() => setReviewPage(1), [providerId]);

  useEffect(() => {
    let active = true;
    setReviewsLoading(true);
    setReviewsError("");
    void api
      .publicProviderReviews(providerId, reviewPage)
      .then((response) => {
        if (active) setReviews(response);
      })
      .catch((reason: unknown) => {
        if (active)
          setReviewsError(
            reason instanceof Error
              ? reason.message
              : "Unable to load reviews.",
          );
      })
      .finally(() => {
        if (active) setReviewsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [providerId, refreshVersion, reviewPage]);

  useEffect(() => {
    const refresh = () => setRefreshVersion((version) => version + 1);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const fallback = window.setInterval(refresh, 60000);
    const endpoint = apiUrl();
    const socket =
      token && endpoint && realtimeSocketEnabled()
        ? io(`${new URL(endpoint).origin}/realtime`, {
            auth: { token },
            transports: ["websocket", "polling"],
            reconnection: true,
          })
        : null;
    socket?.on("connect", () => {
      socket.emit("provider:subscribe", { providerId });
      refresh();
    });
    socket?.on("provider:stats-changed", (event: { providerId?: string }) => {
      if (event.providerId === providerId) refresh();
    });
    socket?.on("provider:profile-changed", (event: { providerId?: string }) => {
      if (event.providerId === providerId) refresh();
    });
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(fallback);
      socket?.disconnect();
    };
  }, [providerId, token]);

  if (error)
    return (
      <main className="public-provider-page provider-state-card">
        <span className="provider-state-icon">!</span>
        <h1>Profile unavailable</h1>
        <p>{error}</p>
        <button className="provider-secondary-action" onClick={back}>
          Go back
        </button>
      </main>
    );

  if (!profile)
    return (
      <main className="public-provider-page" aria-busy="true">
        <button className="back-button" onClick={back}>
          ← Back
        </button>
        <SkeletonCollection
          kind="profile"
          count={1}
          label="Loading provider profile"
        />
      </main>
    );

  const initials = profile.displayName
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  const socialLinks = [
    {
      key: "instagram",
      label: "Instagram",
      url: profile.socialLinks.instagram,
    },
    { key: "linkedin", label: "LinkedIn", url: profile.socialLinks.linkedin },
    { key: "x", label: "X", url: profile.socialLinks.x },
    {
      key: "portfolio",
      label: "Portfolio",
      url: profile.socialLinks.portfolio,
    },
  ].filter((item): item is { key: string; label: string; url: string } =>
    Boolean(item.url),
  );

  return (
    <main className="public-provider-page">
      <button className="back-button" onClick={back}>
        ← {backLabel}
      </button>

      <section className="provider-profile-hero">
        <div className="provider-profile-avatar">
          {profile.hasAvatar ? (
            <img
              src={api.avatarUrl(profile.id, profile.avatarVersion)}
              alt={`${profile.displayName} profile`}
              width={128}
              height={128}
              decoding="async"
            />
          ) : (
            initials
          )}
          <i className={profile.isAvailable ? "online" : "offline"} />
        </div>
        <div className="provider-profile-intro">
          <div className="provider-name-line">
            <h1>{profile.displayName}</h1>
            {profile.verified && (
              <span className="verified-pill">✓ Verified student</span>
            )}
          </div>
          <h2>{profile.headline}</h2>
          <p>
            {profile.program || "Student provider"} · {profile.school.name}
          </p>
          <div
            className={`availability-pill ${profile.isAvailable ? "online" : "offline"}`}
          >
            <i />
            {profile.isAvailable
              ? "Available for new projects"
              : "Not accepting requests right now"}
          </div>
        </div>
        <div
          key={`${profile.rating}-${profile.reviewCount}-${profile.completedOrders}`}
          className="provider-profile-stats"
          aria-label="Provider statistics"
        >
          <div>
            <b>{profile.rating.toFixed(1)}</b>
            <span>Rating</span>
          </div>
          <div>
            <b>{profile.reviewCount}</b>
            <span>Reviews</span>
          </div>
          <div>
            <b>{profile.completedOrders}</b>
            <span>Completed</span>
          </div>
        </div>
      </section>

      <div className="provider-profile-layout">
        <section className="provider-about-card">
          <span className="kicker">ABOUT</span>
          <h2>Meet {profile.displayName.split(" ")[0]}</h2>
          <p>{profile.bio}</p>
          <h3>Skills</h3>
          <div className="provider-skill-list">
            {profile.skills.map((skill) => (
              <span key={skill}>{skill}</span>
            ))}
          </div>
          {socialLinks.length ? (
            <div className="provider-public-links">
              <h3>Contact and portfolio</h3>
              <div>
                {socialLinks.map((link) => (
                  <a
                    key={link.key}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    <span aria-hidden="true">↗</span>
                    {link.label}
                  </a>
                ))}
              </div>
              <small>
                External conversations and payments are not protected by
                CampusGig. Keep bookings, payment, and delivery in the app.
              </small>
            </div>
          ) : null}
          <dl className="provider-facts">
            <div>
              <dt>Campus</dt>
              <dd>
                {profile.school.shortName} · {profile.school.city}
              </dd>
            </div>
            <div>
              <dt>Member since</dt>
              <dd>
                {new Date(profile.memberSince).toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </dd>
            </div>
          </dl>
        </section>

        <section className="provider-services-section">
          <div className="provider-section-heading">
            <div>
              <span className="kicker">SERVICES</span>
              <h2>Published work</h2>
            </div>
            <span>{profile.services.length} available</span>
          </div>
          {profile.services.length ? (
            <div className="provider-service-grid">
              {profile.services.map((service) => (
                <article key={service.id} className="provider-service-card">
                  <div className="provider-service-cover">
                    {service.coverMediaId ? (
                      <img
                        src={api.serviceMediaUrl(
                          service.id,
                          service.coverMediaId,
                        )}
                        alt=""
                        width={520}
                        height={290}
                        loading="lazy"
                      />
                    ) : (
                      <span>{service.category.slice(0, 1)}</span>
                    )}
                  </div>
                  <div>
                    <span className="kicker">{service.category}</span>
                    <h3>{service.title}</h3>
                    <p>
                      From ₱{service.price.toLocaleString()} ·{" "}
                      {service.delivery}
                    </p>
                    <button
                      disabled={!profile.isAvailable}
                      onClick={() => openService(service)}
                    >
                      {profile.isAvailable
                        ? "View service →"
                        : "Currently unavailable"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="provider-empty-services">
              No published services yet.
            </div>
          )}
        </section>
      </div>

      <section className="provider-reviews-section" aria-busy={reviewsLoading}>
        <div className="provider-section-heading">
          <div>
            <span className="kicker">VERIFIED REVIEWS</span>
            <h2>Client feedback</h2>
          </div>
          {reviews && <span>{reviews.summary.total} total</span>}
        </div>

        {reviews?.summary.total ? (
          <div className="provider-review-summary">
            <div className="provider-review-average">
              <strong>{reviews.summary.average.toFixed(1)}</strong>
              <span aria-label={`${reviews.summary.average} out of 5 stars`}>
                {"★".repeat(Math.round(reviews.summary.average))}
                <i>{"★".repeat(5 - Math.round(reviews.summary.average))}</i>
              </span>
              <small>{reviews.summary.total} verified reviews</small>
            </div>
            <div className="provider-rating-bars">
              {reviews.summary.distribution.map((item) => (
                <div key={item.rating}>
                  <span>{item.rating} ★</span>
                  <i>
                    <b
                      style={{
                        width: `${(item.count / reviews.summary.total) * 100}%`,
                      }}
                    />
                  </i>
                  <small>{item.count}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {reviewsError ? (
          <div className="provider-review-empty">{reviewsError}</div>
        ) : reviewsLoading && !reviews ? (
          <SkeletonCollection
            kind="review"
            count={2}
            label="Loading verified reviews"
          />
        ) : reviews?.data.length ? (
          <div
            className={`provider-review-list ${reviewsLoading ? "loading" : ""}`}
          >
            {reviews.data.map((review) => (
              <article key={review.id} className="provider-review-card">
                <div className="provider-review-head">
                  <span className="provider-reviewer-avatar">
                    {review.reviewerLabel.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <b>{review.reviewerLabel}</b>
                    <small>{review.serviceTitle}</small>
                  </div>
                  <time dateTime={review.createdAt}>
                    {new Date(review.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                </div>
                <div
                  className="provider-review-stars"
                  aria-label={`${review.overallRating} out of 5 stars`}
                >
                  {"★".repeat(review.overallRating)}
                  <i>{"★".repeat(5 - review.overallRating)}</i>
                </div>
                {review.comment && <p>{review.comment}</p>}
                {(review.qualityRating ||
                  review.communicationRating ||
                  review.timelinessRating) && (
                  <div className="provider-review-breakdown">
                    {review.qualityRating && (
                      <span>Quality {review.qualityRating}/5</span>
                    )}
                    {review.communicationRating && (
                      <span>Communication {review.communicationRating}/5</span>
                    )}
                    {review.timelinessRating && (
                      <span>Timeliness {review.timelinessRating}/5</span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="provider-review-empty">
            <b>No reviews yet</b>
            <span>Verified feedback will appear after completed orders.</span>
          </div>
        )}

        {reviews && reviews.pagination.totalPages > 1 && (
          <nav
            className="provider-review-pagination"
            aria-label="Provider reviews pages"
          >
            <button
              disabled={reviewPage === 1 || reviewsLoading}
              onClick={() => setReviewPage((page) => page - 1)}
            >
              ← Previous
            </button>
            <span>
              Page {reviews.pagination.page} of {reviews.pagination.totalPages}
            </span>
            <button
              disabled={
                reviewPage === reviews.pagination.totalPages || reviewsLoading
              }
              onClick={() => setReviewPage((page) => page + 1)}
            >
              Next →
            </button>
          </nav>
        )}
      </section>
    </main>
  );
}
