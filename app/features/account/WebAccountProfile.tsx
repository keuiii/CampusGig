"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import type { AuthUser } from "../../types";
import { MfaSecurityPanel } from "./MfaSecurityPanel";

export function WebAccountProfile({
  token,
  user,
  avatarVersion,
  notify,
  onAvatarChanged,
  onOpenWorkspace,
  onLogout,
}: {
  token: string;
  user: AuthUser;
  avatarVersion: number;
  notify: (message: string) => void;
  onAvatarChanged: () => void;
  onOpenWorkspace: () => void;
  onLogout: () => void;
}) {
  const isStudent = user.roles.includes("STUDENT");
  const hasWorkspace = user.roles.some((role) =>
    ["PROVIDER", "SCHOOL_ADMIN", "ADMIN"].includes(role),
  );
  const [uploading, setUploading] = useState(false);
  async function selectAvatar(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type))
      return notify("Choose a JPG or PNG profile picture");
    if (file.size > 5 * 1024 * 1024)
      return notify("Profile picture must be 5 MB or smaller");
    setUploading(true);
    try {
      await api.uploadAvatar(token, file);
      onAvatarChanged();
      notify("Profile picture updated");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to upload profile picture",
      );
    } finally {
      setUploading(false);
    }
  }
  const accountLabel = user.roles.includes("ADMIN")
    ? "PLATFORM ADMINISTRATOR"
    : user.roles.includes("SCHOOL_ADMIN")
      ? "SCHOOL ADMINISTRATOR"
      : user.roles.includes("PROVIDER")
        ? "STUDENT PROVIDER"
        : isStudent
          ? "STUDENT CLIENT ACCOUNT"
          : "CLIENT ACCOUNT";
  return (
    <main className="access-page">
      <section className="student-web-card">
        <label
          className={`web-avatar-editor ${uploading ? "uploading" : ""}`}
          title="Change profile picture"
        >
          <span className="avatar web-profile-avatar">
            {uploading ? (
              "…"
            ) : user.hasAvatar ? (
              <img
                src={api.avatarUrl(user.id, avatarVersion)}
                alt={`${user.displayName} profile`}
              />
            ) : (
              user.displayName.slice(0, 2).toUpperCase()
            )}
          </span>
          <span className="web-avatar-badge">＋</span>
          <input
            type="file"
            accept="image/jpeg,image/png"
            disabled={uploading}
            onChange={(event) => {
              void selectAvatar(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <small className="avatar-instruction">
          Click your photo to upload a JPG or PNG up to 5 MB
        </small>
        <span className="kicker">{accountLabel}</span>
        <h1>Welcome, {user.displayName}</h1>
        <p>
          Your profile picture is shared across the CampusGig web and mobile
          apps. Your account can keep multiple roles without creating separate
          logins.
        </p>
        <div className="student-session">
          <div>
            <small>ACCOUNT</small>
            <b>{user.email}</b>
          </div>
          <div>
            <small>ACCESS</small>
            <b>{user.roles.join(" · ")}</b>
          </div>
        </div>
        <div className="web-account-actions">
          {hasWorkspace && (
            <button className="primary-button" onClick={onOpenWorkspace}>
              Open my workspace
            </button>
          )}
          <button className="outline-action" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </section>
      <MfaSecurityPanel token={token} notify={notify} />
    </main>
  );
}
