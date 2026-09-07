"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type {
  AuthUser,
  StudentProfile,
  StudentVerificationRequest,
} from "../../types";

export function ProviderAccessGuide({
  token,
  user,
  onOpenAccount,
  onAccountRefreshed,
}: {
  token: string;
  user: AuthUser;
  onOpenAccount: () => void;
  onAccountRefreshed: (user: AuthUser) => void;
}) {
  const isStudent = user.roles.includes("STUDENT");
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [verification, setVerification] =
    useState<StudentVerificationRequest | null>(null);
  const [loading, setLoading] = useState(isStudent);
  const [checked, setChecked] = useState(!isStudent);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    if (!isStudent) return;
    const startedAt = Date.now();
    const isManualRefresh = checked;
    setLoading(true);
    setError("");
    try {
      const [profileResult, verificationResult, currentUser] =
        await Promise.all([
          api.studentProfile(token),
          api.studentVerification(token),
          api.me(token),
        ]);
      setProfile(profileResult.data);
      setVerification(verificationResult.data);
      onAccountRefreshed(currentUser);
      setLastCheckedAt(new Date());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to check provider eligibility.",
      );
    } finally {
      if (isManualRefresh) {
        const remaining = 850 - (Date.now() - startedAt);
        if (remaining > 0)
          await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      setLoading(false);
      setChecked(true);
    }
  }

  useEffect(() => {
    void refresh();
  }, [token, isStudent]);

  if (!isStudent) {
    return (
      <main className="provider-access-page">
        <section className="provider-access-hero client-only">
          <span className="provider-access-icon">◇</span>
          <span className="kicker">PROVIDER ACCESS</span>
          <h1>This account is for clients</h1>
          <p>
            Your account does not have Student or Provider access. You can
            continue discovering services, placing orders, and messaging student
            providers as a client.
          </p>
          <div className="provider-access-notice">
            <b>Why can’t I offer services?</b>
            <span>
              CampusGig providers must be students from participating schools
              and complete school verification before publishing services.
            </span>
          </div>
          <p className="provider-access-footnote">
            If you registered with the wrong account type and are currently a
            student, contact a CampusGig administrator so your account can be
            reviewed safely.
          </p>
          <button className="outline-action" onClick={onOpenAccount}>
            View my account
          </button>
        </section>
      </main>
    );
  }

  const profileComplete = Boolean(
    profile?.schoolId && profile.program && profile.yearLevel,
  );
  const verificationStatus =
    profile?.verificationStatus ?? verification?.status ?? "UNVERIFIED";
  const verificationSubmitted = ["PENDING", "APPROVED"].includes(
    verificationStatus,
  );
  const approved = verificationStatus === "APPROVED";

  const steps = [
    {
      title: "Student account",
      description: "Your account is registered with the Student role.",
      complete: true,
      label: "Complete",
    },
    {
      title: "Complete your student profile",
      description:
        "Add your participating school, program, year level, and student information from the Profile tab in the mobile app.",
      complete: profileComplete,
      label: profileComplete ? "Complete" : "Next step",
    },
    {
      title: "Submit school verification",
      description:
        "Upload a clear student ID so an authorized administrator can verify your school membership.",
      complete: verificationSubmitted,
      label:
        verificationStatus === "REJECTED"
          ? "Needs attention"
          : verificationSubmitted
            ? "Submitted"
            : "Waiting",
    },
    {
      title: "Receive provider access",
      description:
        "After approval, CampusGig automatically adds the Provider role and unlocks your dashboard.",
      complete: approved,
      label: approved
        ? "Approved"
        : verificationStatus === "PENDING"
          ? "Under review"
          : "Locked",
    },
  ];

  return (
    <main className="provider-access-page">
      <section className="provider-access-hero">
        <span className="provider-access-icon">↗</span>
        <span className="kicker">BECOME A PROVIDER</span>
        <h1>Turn your student skills into opportunities</h1>
        <p>
          Finish the steps below to unlock the provider dashboard and publish
          services to the CampusGig community.
        </p>
        {!checked ? (
          <div className="provider-access-loading">Checking your progress…</div>
        ) : (
          <div className={`provider-steps ${loading ? "refreshing" : ""}`}>
            {steps.map((step, index) => (
              <div
                key={step.title}
                className={step.complete ? "complete" : "pending"}
              >
                <i>{step.complete ? "✓" : index + 1}</i>
                <span>
                  <b>{step.title}</b>
                  <small>{step.description}</small>
                </span>
                <em>{step.label}</em>
              </div>
            ))}
          </div>
        )}
        {verificationStatus === "REJECTED" && (
          <div className="provider-access-notice warning">
            <b>Your verification needs attention</b>
            <span>
              {verification?.rejectionReason ??
                "Review your student information and submit a clearer student ID."}
            </span>
          </div>
        )}
        {error && <div className="provider-access-error">{error}</div>}
        <div className="provider-access-actions">
          <button className="primary-button" onClick={onOpenAccount}>
            Open my profile
          </button>
          <button
            className="outline-action"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <span
              className={`refresh-progress-icon ${loading ? "spinning" : ""}`}
            >
              ↻
            </span>
            {loading ? "Refreshing…" : "Refresh progress"}
          </button>
        </div>
        {lastCheckedAt && (
          <span
            className={`provider-last-checked ${loading ? "updating" : ""}`}
          >
            {loading
              ? "Checking the latest account progress…"
              : `Progress checked at ${lastCheckedAt.toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`}
          </span>
        )}
        <small className="provider-access-footnote">
          Student profile setup and ID submission are currently available in the
          CampusGig mobile Profile tab.
        </small>
      </section>
    </main>
  );
}
