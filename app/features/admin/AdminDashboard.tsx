"use client";

import { FormEvent, useEffect, useState } from "react";
import { DashboardHeader, Stat } from "../../components/dashboard";
import { api } from "../../lib/api";
import type {
  AuthUser,
  DashboardStats,
  ModerationService,
  School,
  SchoolAdministrator,
  Verification,
} from "../../types";

export function AdminDashboard({
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
  const [queue, setQueue] = useState<Verification[]>([]);
  const [serviceQueue, setServiceQueue] = useState<ModerationService[]>([]);
  const [schoolAdmins, setSchoolAdmins] = useState<SchoolAdministrator[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    registeredStudents: 0,
    activeServices: 0,
    completedOrders: 0,
    pendingVerifications: 0,
  });
  const [loading, setLoading] = useState(true);
  const [schoolForm, setSchoolForm] = useState({
    name: "",
    shortName: "",
    emailDomain: "",
    address: "",
  });
  const [schoolAdminForm, setSchoolAdminForm] = useState({
    email: "",
    schoolId: "",
  });

  async function refresh() {
    setLoading(true);
    try {
      const [
        nextQueue,
        nextServices,
        nextSchools,
        nextSchoolAdmins,
        nextStats,
      ] = await Promise.all([
        api.verifications(token),
        api.moderationServices(token),
        api.adminSchools(token),
        api.schoolAdministrators(token),
        api.adminStats(token),
      ]);
      setQueue(nextQueue);
      setServiceQueue(nextServices);
      setSchools(nextSchools);
      setSchoolAdmins(nextSchoolAdmins);
      setStats(nextStats);
    } catch {
      notify("Unable to load administrator data");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [token]);

  async function review(item: Verification, decision: "approve" | "reject") {
    const reason =
      decision === "reject"
        ? window
            .prompt(
              "Why is this verification being rejected? The student will see this reason.",
            )
            ?.trim()
        : "";
    if (decision === "reject" && !reason) return;
    try {
      if (decision === "approve") await api.approveVerification(token, item.id);
      else await api.rejectVerification(token, item.id, reason!);
      setQueue((items) => items.filter((entry) => entry.id !== item.id));
      setStats((value) => ({
        ...value,
        pendingVerifications: Math.max(0, value.pendingVerifications - 1),
      }));
      notify(
        `Verification ${decision === "approve" ? "approved" : "returned"}`,
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
      notify("Unable to open the private student document");
    }
  }
  async function moderateService(
    item: ModerationService,
    decision: "approve" | "reject",
  ) {
    const reason =
      decision === "reject"
        ? window
            .prompt(
              "Why is this service being rejected? The provider will see this reason.",
            )
            ?.trim()
        : "";
    if (decision === "reject" && !reason) return;
    try {
      if (decision === "approve") await api.approveService(token, item.id);
      else await api.rejectService(token, item.id, reason!);
      setServiceQueue((items) => items.filter((entry) => entry.id !== item.id));
      if (decision === "approve")
        setStats((value) => ({
          ...value,
          activeServices: value.activeServices + 1,
        }));
      notify(
        `Service ${decision === "approve" ? "approved and published" : "returned to the provider"}`,
      );
    } catch (caught) {
      notify(
        caught instanceof Error ? caught.message : "Unable to moderate service",
      );
    }
  }
  async function addSchool(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await api.createSchool(token, {
        ...schoolForm,
        emailDomain: schoolForm.emailDomain || undefined,
        address: schoolForm.address || undefined,
      });
      setSchools((items) =>
        [...items, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSchoolForm({ name: "", shortName: "", emailDomain: "", address: "" });
      notify("Participating school added as pending");
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Unable to add school");
    }
  }
  async function changeSchoolStatus(
    school: School,
    status: "PENDING" | "ACTIVE" | "DISABLED",
  ) {
    try {
      const updated = await api.updateSchoolStatus(token, school.id, status);
      setSchools((items) =>
        items.map((item) => (item.id === school.id ? updated : item)),
      );
      notify(`${school.shortName} is now ${status.toLowerCase()}`);
    } catch {
      notify("Unable to update school status");
    }
  }
  async function assignSchoolAdmin(event: FormEvent) {
    event.preventDefault();
    try {
      const assignment = await api.assignSchoolAdministrator(
        token,
        schoolAdminForm.email.trim(),
        schoolAdminForm.schoolId,
      );
      setSchoolAdmins((items) => [
        assignment,
        ...items.filter((item) => item.userId !== assignment.userId),
      ]);
      setSchoolAdminForm({ email: "", schoolId: "" });
      notify("School administrator access assigned");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to assign school administrator",
      );
    }
  }
  async function removeSchoolAdmin(item: SchoolAdministrator) {
    if (
      !window.confirm(
        `Remove school administrator access from ${item.user.displayName}?`,
      )
    )
      return;
    try {
      await api.removeSchoolAdministrator(token, item.userId);
      setSchoolAdmins((items) =>
        items.filter((entry) => entry.userId !== item.userId),
      );
      notify("School administrator access removed");
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to remove school administrator",
      );
    }
  }

  return (
    <main className="dashboard-page">
      <DashboardHeader
        kicker="CAMPUSGIG ADMIN"
        title="Platform overview"
        subtitle={`Signed in as ${user.displayName}`}
        action={
          <button className="outline-action" onClick={onLogout}>
            Sign out
          </button>
        }
      />
      <div className="stats-grid">
        <Stat
          label="Registered students"
          value={String(stats.registeredStudents)}
          change="Real database accounts"
          icon="◎"
        />
        <Stat
          label="Active services"
          value={String(stats.activeServices)}
          change="Published listings"
          icon="◇"
        />
        <Stat
          label="Completed orders"
          value={String(stats.completedOrders)}
          change="Persisted orders"
          icon="✓"
        />
        <Stat
          label="Pending verification"
          value={String(queue.length)}
          change="Requires admin review"
          icon="!"
        />
      </div>
      {loading ? (
        <div className="admin-loading">Loading administrator workspace…</div>
      ) : (
        <>
          <section className="panel admin-panel">
            <div className="panel-title">
              <div>
                <span className="kicker">MARKETPLACE SAFETY</span>
                <h2>Service moderation queue</h2>
              </div>
              <span className="queue-count">
                {serviceQueue.length} awaiting review
              </span>
            </div>
            {serviceQueue.length ? (
              serviceQueue.map((item) => (
                <div className="service-review-row" key={item.id}>
                  <div className="service-review-main">
                    <b>{item.title}</b>
                    <small>
                      {item.category.name} ·{" "}
                      {item.deliveryMethod.replace("_", " ")}
                    </small>
                    <p>{item.description}</p>
                  </div>
                  <div>
                    <b>{item.provider.displayName}</b>
                    <small>
                      {item.provider.studentProfile?.school?.shortName ??
                        "Verified provider"}
                    </small>
                  </div>
                  <div className="service-review-package">
                    <b>
                      ₱
                      {Math.round((item.packages[0]?.priceCentavos ?? 0) / 100)}
                    </b>
                    <small>
                      {item.packages[0]?.deliveryDays ?? 0} day delivery ·{" "}
                      {item.packages[0]?.revisionLimit ?? 0} revisions
                    </small>
                  </div>
                  <div className="verify-actions">
                    <button
                      className="reject"
                      onClick={() => moderateService(item, "reject")}
                    >
                      Reject
                    </button>
                    <button
                      className="approve"
                      onClick={() => moderateService(item, "approve")}
                    >
                      ✓ Publish
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty compact">
                <span>◇</span>
                <h3>No services awaiting review</h3>
                <p>
                  Provider submissions will appear here before they become
                  public.
                </p>
              </div>
            )}
          </section>
          <section className="panel admin-panel">
            <div className="panel-title">
              <div>
                <span className="kicker">TRUST & SAFETY</span>
                <h2>Student verification queue</h2>
              </div>
              <span className="queue-count">
                {queue.length} awaiting review
              </span>
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
                      Submitted{" "}
                      {new Date(item.submittedAt).toLocaleDateString()}
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
                <p>New student submissions will appear here.</p>
              </div>
            )}
          </section>
          <div className="admin-school-grid">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <span className="kicker">SCHOOL ADMINISTRATORS</span>
                  <h2>Verification access</h2>
                </div>
                <span className="queue-count">
                  {schoolAdmins.length} assigned
                </span>
              </div>
              <form className="school-admin-form" onSubmit={assignSchoolAdmin}>
                <label>
                  Existing account email
                  <input
                    type="email"
                    value={schoolAdminForm.email}
                    onChange={(event) =>
                      setSchoolAdminForm({
                        ...schoolAdminForm,
                        email: event.target.value,
                      })
                    }
                    placeholder="administrator@school.edu.ph"
                    required
                  />
                </label>
                <label>
                  Assigned school
                  <select
                    value={schoolAdminForm.schoolId}
                    onChange={(event) =>
                      setSchoolAdminForm({
                        ...schoolAdminForm,
                        schoolId: event.target.value,
                      })
                    }
                    required
                  >
                    <option value="">Select an active school</option>
                    {schools
                      .filter((school) => school.status === "ACTIVE")
                      .map((school) => (
                        <option key={school.id} value={school.id}>
                          {school.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="primary-button wide">Assign access</button>
              </form>
              <div className="school-admin-list">
                {schoolAdmins.map((item) => (
                  <div className="school-admin-row" key={item.userId}>
                    <div>
                      <b>{item.user.displayName}</b>
                      <small>
                        {item.user.email} · {item.school.shortName}
                      </small>
                    </div>
                    <button
                      className="reject"
                      onClick={() => removeSchoolAdmin(item)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {schoolAdmins.length === 0 && (
                  <p className="admin-empty-copy">
                    No school administrators assigned yet.
                  </p>
                )}
              </div>
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <span className="kicker">PARTICIPATING SCHOOLS</span>
                  <h2>School access</h2>
                </div>
                <span className="queue-count">{schools.length} registered</span>
              </div>
              <div className="school-admin-list">
                {schools.map((school) => (
                  <div className="school-admin-row" key={school.id}>
                    <div>
                      <b>{school.name}</b>
                      <small>
                        {school.shortName} · {school.city}
                      </small>
                    </div>
                    <span
                      className={`school-status ${school.status?.toLowerCase()}`}
                    >
                      {school.status}
                    </span>
                    <select
                      value={school.status}
                      onChange={(event) =>
                        changeSchoolStatus(
                          school,
                          event.target.value as
                            | "PENDING"
                            | "ACTIVE"
                            | "DISABLED",
                        )
                      }
                    >
                      <option value="PENDING">Pending</option>
                      <option value="ACTIVE">Active</option>
                      <option value="DISABLED">Disabled</option>
                    </select>
                  </div>
                ))}
                {schools.length === 0 && (
                  <p className="admin-empty-copy">
                    No participating schools have been registered.
                  </p>
                )}
              </div>
            </section>
            <section className="panel">
              <span className="kicker">ADD A REAL SCHOOL</span>
              <h2>Register participating school</h2>
              <form className="school-admin-form" onSubmit={addSchool}>
                <label>
                  School name
                  <input
                    value={schoolForm.name}
                    onChange={(event) =>
                      setSchoolForm({ ...schoolForm, name: event.target.value })
                    }
                    required
                    minLength={2}
                  />
                </label>
                <label>
                  Short name
                  <input
                    value={schoolForm.shortName}
                    onChange={(event) =>
                      setSchoolForm({
                        ...schoolForm,
                        shortName: event.target.value,
                      })
                    }
                    required
                    minLength={2}
                    maxLength={30}
                  />
                </label>
                <label>
                  Email domain <small>Optional</small>
                  <input
                    value={schoolForm.emailDomain}
                    onChange={(event) =>
                      setSchoolForm({
                        ...schoolForm,
                        emailDomain: event.target.value,
                      })
                    }
                    placeholder="school.edu.ph"
                  />
                </label>
                <label>
                  Address <small>Optional</small>
                  <input
                    value={schoolForm.address}
                    onChange={(event) =>
                      setSchoolForm({
                        ...schoolForm,
                        address: event.target.value,
                      })
                    }
                  />
                </label>
                <button className="primary-button wide">Add as pending</button>
              </form>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
