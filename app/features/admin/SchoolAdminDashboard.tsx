"use client";

import { useEffect, useState } from "react";
import { DashboardHeader } from "../../components/dashboard";
import { useAppDialog } from "../../components/app-dialog";
import { api } from "../../lib/api";
import { SkeletonCollection } from "../../components/Skeletons";
import type { AuthUser, Verification } from "../../types";

export function SchoolAdminDashboard({
  token,
  user,
  notify,
  onLogout,
}: {
  token: string;
  user: AuthUser;
  notify: (s: string) => void;
  onLogout: () => void;
}) {
  const appDialog = useAppDialog();
  const [queue, setQueue] = useState<Verification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .verifications(token)
      .then((page) => {
        setQueue(page.data);
        setNextCursor(page.pagination.nextCursor);
        setHasMore(page.pagination.hasMore);
      })
      .catch(() => notify("Unable to load your school verification queue"))
      .finally(() => setLoading(false));
  }, [notify, token]);
  async function loadMore() {
    if (loadingMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.verifications(token, nextCursor);
      setQueue((current) => [...current, ...page.data]);
      setNextCursor(page.pagination.nextCursor);
      setHasMore(page.pagination.hasMore);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Unable to load more");
    } finally {
      setLoadingMore(false);
    }
  }
  async function review(item: Verification, decision: "approve" | "reject") {
    const reason =
      decision === "reject"
        ? await appDialog.prompt({
            title: "Return this verification?",
            message:
              "Explain what must be corrected. The student will receive this reason.",
            placeholder: "Describe the verification issue…",
            minLength: 3,
            maxLength: 500,
            confirmLabel: "Return verification",
            cancelLabel: "Keep reviewing",
            tone: "danger",
          })
        : "";
    if (decision === "reject" && !reason) return;
    if (
      decision === "approve" &&
      !(await appDialog.confirm({
        title: "Approve this student?",
        message:
          "The student identity will be verified for your assigned school.",
        confirmLabel: "Approve student",
        cancelLabel: "Review again",
      }))
    )
      return;
    try {
      if (decision === "approve") await api.approveVerification(token, item.id);
      else await api.rejectVerification(token, item.id, reason!);
      setQueue((items) => items.filter((entry) => entry.id !== item.id));
      notify(
        `Student verification ${decision === "approve" ? "approved" : "returned"}`,
      );
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to review verification",
      );
    }
  }
  async function openDocument(item: Verification) {
    try {
      const blob = await api.verificationDocument(token, item.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      notify("Unable to open this private student document");
    }
  }
  return (
    <main className="dashboard-page">
      <DashboardHeader
        kicker="SCHOOL ADMINISTRATOR"
        title="Student verification"
        subtitle={`Signed in as ${user.displayName} · Only your assigned school is shown`}
        action={
          <button className="outline-action" onClick={onLogout}>
            Sign out
          </button>
        }
      />
      {loading ? (
        <SkeletonCollection
          kind="admin"
          label="Loading your school workspace"
        />
      ) : (
        <section className="panel admin-panel">
          <div className="panel-title">
            <div>
              <span className="kicker">PRIVATE REVIEW QUEUE</span>
              <h2>Students awaiting verification</h2>
            </div>
            <span className="queue-count">{queue.length} awaiting review</span>
          </div>
          {queue.length ? (
            queue.map((item) => (
              <div className="verify-row" key={item.id}>
                <span className="avatar large">
                  {item.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <div className="verify-name">
                  <b>{item.name}</b>
                  <small>
                    {item.program || "Program not provided"}
                    {item.yearLevel ? ` · Year ${item.yearLevel}` : ""}
                  </small>
                </div>
                <div>
                  <b>{item.school}</b>
                  <small>
                    Submitted {new Date(item.submittedAt).toLocaleDateString()}
                  </small>
                </div>
                <button
                  className="document-chip"
                  onClick={() => openDocument(item)}
                >
                  ▤ View student ID
                </button>
                <div className="verify-actions">
                  <button
                    className="reject"
                    onClick={() => review(item, "reject")}
                  >
                    Reject
                  </button>
                  <button
                    className="approve"
                    onClick={() => review(item, "approve")}
                  >
                    ✓ Approve
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="empty compact">
              <span>◇</span>
              <h3>No verification requests</h3>
              <p>New submissions from your assigned school will appear here.</p>
            </div>
          )}
          {hasMore && (
            <button
              className="primary-button"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading..." : "Load more verifications"}
            </button>
          )}
        </section>
      )}
      {appDialog.dialog}
    </main>
  );
}
