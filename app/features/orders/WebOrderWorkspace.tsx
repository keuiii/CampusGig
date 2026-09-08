"use client";

import { FormEvent, Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { io } from "socket.io-client";
import { api } from "../../lib/api";
import { apiUrl } from "../../lib/http-client";
import type {
  DisputeReason,
  MarketplaceOrder,
  OrderDispute,
  OrderMessage,
  OrderWorkspace,
} from "../../types";

const campusTimeZone = "Asia/Manila";

function campusDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: campusTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function messageTimeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], {
    timeZone: campusTimeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function messageDateLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const day = campusDateKey(date);
  const dayLabel =
    day === campusDateKey(today)
      ? "Today"
      : day === campusDateKey(yesterday)
        ? "Yesterday"
        : date.toLocaleDateString([], {
            timeZone: campusTimeZone,
            month: "short",
            day: "numeric",
            year:
              new Intl.DateTimeFormat("en", {
                timeZone: campusTimeZone,
                year: "numeric",
              }).format(date) ===
              new Intl.DateTimeFormat("en", {
                timeZone: campusTimeZone,
                year: "numeric",
              }).format(today)
                ? undefined
                : "numeric",
          });

  return `${dayLabel} at ${messageTimeLabel(value)}`;
}

export function WebOrderWorkspace({
  token,
  order,
  perspective = "provider",
  onClose,
  onChanged,
}: {
  token: string;
  order: MarketplaceOrder;
  perspective?: "client" | "provider";
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<OrderWorkspace | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [messageFiles, setMessageFiles] = useState<File[]>([]);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [deliveryFiles, setDeliveryFiles] = useState<File[]>([]);
  const [submittingDelivery, setSubmittingDelivery] = useState(false);
  const [revisionInstructions, setRevisionInstructions] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [acting, setActing] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [peerRead, setPeerRead] = useState(false);
  const [dispute, setDispute] = useState<OrderDispute | null>(null);
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>("SERVICE_NOT_DELIVERED");
  const [disputeDetails, setDisputeDetails] = useState("");
  const [submittingDispute, setSubmittingDispute] = useState(false);
  async function refresh() {
    const [orderResult, messageResult, disputeResult] = await Promise.all([
      api.order(token, order.id),
      api.messages(token, order.id),
      api.orderDispute(token, order.id),
    ]);
    setDetail(orderResult.data);
    setMessages(messageResult.data);
    setDispute(disputeResult.data);
  }
  useEffect(() => {
    void refresh();
    const endpoint = apiUrl();
    const socket = endpoint
      ? io(`${new URL(endpoint).origin}/realtime`, {
          auth: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
        })
      : null;
    socket?.on("connect", () => {
      setRealtimeConnected(true);
      socket.emit("conversation:subscribe", { orderId: order.id });
    });
    socket?.on("disconnect", () => setRealtimeConnected(false));
    socket?.on("message:created", (event: { orderId: string; message: OrderMessage }) => {
      if (event.orderId !== order.id) return;
      setMessages((items) => items.some((item) => item.id === event.message.id) ? items : [...items, event.message]);
    });
    socket?.on("conversation:read", (event: { orderId: string }) => {
      if (event.orderId === order.id) setPeerRead(true);
    });
    const timer = window.setInterval(() => void refresh(), 20000);
    return () => {
      window.clearInterval(timer);
      socket?.disconnect();
    };
  }, [order.id, token]);
  async function send(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !messageFiles.length) || sending) return;
    setSending(true);
    try {
      const result = messageFiles.length
        ? await api.sendMessageAttachments(token, order.id, messageFiles, body)
        : await api.sendMessage(token, order.id, body);
      setMessages((items) => items.some((item) => item.id === result.data.id) ? items : [...items, result.data]);
      setPeerRead(false);
      setDraft("");
      setMessageFiles([]);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to send message",
      );
    } finally {
      setSending(false);
    }
  }
  async function submitDelivery(event: FormEvent) {
    event.preventDefault();
    if (
      !detail ||
      deliveryNote.trim().length < 3 ||
      !deliveryFiles.length ||
      submittingDelivery
    )
      return;
    setSubmittingDelivery(true);
    try {
      await api.deliverOrder(
        token,
        detail.id,
        deliveryNote.trim(),
        deliveryFiles,
      );
      setDeliveryNote("");
      setDeliveryFiles([]);
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to submit delivery",
      );
    } finally {
      setSubmittingDelivery(false);
    }
  }
  async function downloadFile(fileId: string, originalName: string) {
    try {
      const blob = await api.orderFile(token, order.id, fileId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = originalName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to download file",
      );
    }
  }
  async function clientAction(action: "complete" | "revision" | "review") {
    if (!detail || acting) return;
    setActing(true);
    try {
      const result =
        action === "complete"
          ? await api.completeOrder(token, detail.id)
          : action === "revision"
            ? await api.requestOrderRevision(
                token,
                detail.id,
                revisionInstructions.trim(),
              )
            : await api.reviewOrder(token, detail.id, {
                overallRating: rating,
                qualityRating: rating,
                communicationRating: rating,
                timelinessRating: rating,
                comment: reviewComment.trim() || undefined,
              });
      setRevisionInstructions("");
      setReviewComment("");
      window.alert(result.message);
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Unable to update the order",
      );
    } finally {
      setActing(false);
    }
  }
  async function submitDispute(event: FormEvent) {
    event.preventDefault();
    if (submittingDispute || disputeDetails.trim().length < 10) return;
    if (!window.confirm("Submit this report to CampusGig administrators for review?")) return;
    setSubmittingDispute(true);
    try {
      const result = await api.openOrderDispute(
        token,
        order.id,
        disputeReason,
        disputeDetails.trim(),
      );
      setDispute(result.data);
      setShowDisputeForm(false);
      setDisputeDetails("");
      window.alert(result.message);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to submit the report");
    } finally {
      setSubmittingDispute(false);
    }
  }
  const active = detail ?? order;
  const canDeliver =
    perspective === "provider" &&
    (active.status === "IN_PROGRESS" || active.status === "REVISION_REQUESTED");
  const counterparty = perspective === "client" ? order.provider : order.client;
  return createPortal(
    <div
      className="workspace-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Order workspace ${order.orderNumber}`}
    >
      <div className="web-workspace">
        <header>
          <div>
            <span className="kicker">ORDER WORKSPACE</span>
            <h2>{order.title}</h2>
            <small>
              {order.orderNumber} · {active.status.replaceAll("_", " ")}
            </small>
          </div>
          <button onClick={onClose} aria-label="Close order workspace">
            ×
          </button>
        </header>
        <div className="web-workspace-grid">
          <aside>
            <section>
              <h3>Project requirements</h3>
              <p>{order.requirements}</p>
              <div className="workspace-facts">
                <span>
                  <small>
                    {perspective === "client" ? "PROVIDER" : "CLIENT"}
                  </small>
                  <b>{counterparty.displayName}</b>
                </span>
                <span>
                  <small>PACKAGE</small>
                  <b>{order.package.name}</b>
                </span>
                <span>
                  <small>REVISIONS</small>
                  <b>
                    {active.revisionsUsed}/{active.revisionLimit}
                  </b>
                </span>
                <span>
                  <small>DUE</small>
                  <b>{new Date(order.dueAt).toLocaleDateString()}</b>
                </span>
              </div>
            </section>
            {active.revisions?.length > 0 && (
              <section>
                <h3>Revision instructions</h3>
                {active.revisions.map((revision) => (
                  <div className="workspace-revision" key={revision.id}>
                    <b>
                      Revision {revision.sequenceNumber} · {revision.status}
                    </b>
                    <p>{revision.instructions}</p>
                  </div>
                ))}
              </section>
            )}
            {canDeliver && (
              <section>
                <h3>
                  {active.status === "REVISION_REQUESTED"
                    ? "Submit revised work"
                    : "Submit completed work"}
                </h3>
                <form className="delivery-form" onSubmit={submitDelivery}>
                  <textarea
                    value={deliveryNote}
                    onChange={(event) => setDeliveryNote(event.target.value)}
                    maxLength={1000}
                    placeholder="Tell the client what you completed…"
                    required
                  />
                  <label>
                    Attach up to five files
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.docx,.xlsx"
                      onChange={(event) =>
                        setDeliveryFiles(
                          Array.from(event.target.files ?? []).slice(0, 5),
                        )
                      }
                    />
                  </label>
                  {deliveryFiles.length > 0 && (
                    <small>
                      {deliveryFiles.map((file) => file.name).join(" · ")}
                    </small>
                  )}
                  <button
                    disabled={
                      submittingDelivery ||
                      deliveryNote.trim().length < 3 ||
                      !deliveryFiles.length
                    }
                  >
                    {submittingDelivery ? "Uploading…" : "Submit delivery →"}
                  </button>
                </form>
              </section>
            )}
            {active.files?.length > 0 && (
              <section>
                <h3>Delivery files</h3>
                <div className="workspace-files">
                  {active.files.map((file) => (
                    <button
                      key={file.id}
                      onClick={() =>
                        void downloadFile(file.id, file.originalName)
                      }
                    >
                      <span>⇩</span>
                      <b>{file.originalName}</b>
                      <small>
                        {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB ·{" "}
                        {file.purpose.replaceAll("_", " ")}
                      </small>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {perspective === "client" && active.status === "SUBMITTED" && (
              <section className="client-order-actions">
                <span className="kicker">REVIEW DELIVERY</span>
                <h3>Is the work ready?</h3>
                <p>
                  Download and check the submitted files. Accept the delivery
                  when it is complete, or provide clear revision instructions.
                </p>
                <button
                  className="accept-order-button"
                  disabled={acting}
                  onClick={() => void clientAction("complete")}
                >
                  {acting ? "Updating…" : "✓ Accept delivery"}
                </button>
                {active.revisionsUsed < active.revisionLimit && (
                  <div className="revision-request-form">
                    <textarea
                      value={revisionInstructions}
                      onChange={(event) =>
                        setRevisionInstructions(event.target.value)
                      }
                      maxLength={2000}
                      placeholder="Describe exactly what needs to be changed…"
                    />
                    <button
                      disabled={
                        acting || revisionInstructions.trim().length < 10
                      }
                      onClick={() => void clientAction("revision")}
                    >
                      Request revision
                    </button>
                  </div>
                )}
              </section>
            )}
            {perspective === "client" &&
              active.status === "COMPLETED" &&
              !active.review && (
                <section className="client-order-actions">
                  <span className="kicker">RATE YOUR PROVIDER</span>
                  <h3>How was your experience?</h3>
                  <div className="web-rating" aria-label="Rating">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        className={value <= rating ? "active" : ""}
                        aria-label={`${value} star${value === 1 ? "" : "s"}`}
                        onClick={() => setRating(value)}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value)}
                    maxLength={1000}
                    placeholder="Share your experience (optional)…"
                  />
                  <button
                    className="accept-order-button"
                    disabled={acting}
                    onClick={() => void clientAction("review")}
                  >
                    {acting ? "Submitting…" : `Submit ${rating}-star review`}
                  </button>
                </section>
              )}
            {perspective === "client" && active.review && (
              <section className="submitted-review">
                <strong>{"★".repeat(active.review.overallRating)}</strong>
                <h3>Review submitted</h3>
                {active.review.comment && <p>{active.review.comment}</p>}
              </section>
            )}
            {["ACCEPTED", "IN_PROGRESS", "SUBMITTED", "REVISION_REQUESTED", "COMPLETED"].includes(active.status) && (
              <section className="workspace-dispute">
                <span className="kicker">SUPPORT & SAFETY</span>
                {dispute ? (
                  <div className="dispute-status-card">
                    <div>
                      <h3>Report {dispute.status.replaceAll("_", " ").toLowerCase()}</h3>
                      <p>{dispute.reason.replaceAll("_", " ").toLowerCase()} · Submitted {new Date(dispute.createdAt).toLocaleDateString()}</p>
                    </div>
                    <span>{dispute.status.replaceAll("_", " ")}</span>
                    <p>{dispute.details}</p>
                    {dispute.resolutionNote && <p><b>Resolution:</b> {dispute.resolutionNote}</p>}
                  </div>
                ) : showDisputeForm ? (
                  <form className="dispute-form" onSubmit={submitDispute}>
                    <h3>Report an order problem</h3>
                    <p>CampusGig administrators will review this report. Messages and order activity remain available as evidence.</p>
                    <label>Reason
                      <select value={disputeReason} onChange={(event) => setDisputeReason(event.target.value as DisputeReason)}>
                        <option value="SERVICE_NOT_DELIVERED">Service not delivered</option>
                        <option value="QUALITY_ISSUE">Quality issue</option>
                        <option value="REQUIREMENTS_MISMATCH">Requirements mismatch</option>
                        <option value="PAYMENT_ISSUE">Payment issue</option>
                        <option value="CONDUCT">Conduct or safety concern</option>
                        <option value="OTHER">Other</option>
                      </select>
                    </label>
                    <label>What happened?
                      <textarea value={disputeDetails} onChange={(event) => setDisputeDetails(event.target.value)} minLength={10} maxLength={2000} placeholder="Provide specific details for the review team…" required />
                    </label>
                    <div className="dispute-form-actions">
                      <button type="button" className="reject" onClick={() => setShowDisputeForm(false)}>Cancel</button>
                      <button disabled={submittingDispute || disputeDetails.trim().length < 10}>{submittingDispute ? "Submitting…" : "Submit report"}</button>
                    </div>
                  </form>
                ) : (
                  <div className="dispute-entry">
                    <div><h3>Need help with this order?</h3><p>Report delivery, quality, payment, or conduct problems for administrator review.</p></div>
                    <button onClick={() => setShowDisputeForm(true)}>Report a problem</button>
                  </div>
                )}
              </section>
            )}
            <section>
              <h3>Order timeline</h3>
              <div className="web-timeline">
                {detail?.history.map((item) => (
                  <div key={item.id}>
                    <i />
                    <span>
                      <b>{item.toStatus.replaceAll("_", " ")}</b>
                      <small>
                        {item.note} · {item.actor.displayName}
                      </small>
                      <time>{new Date(item.createdAt).toLocaleString()}</time>
                    </span>
                  </div>
                )) ?? <p>Loading timeline…</p>}
              </div>
            </section>
          </aside>
          <main>
            <div className="workspace-chat-head">
              <div>
                <h3>Order messages</h3>
                <small>
                  <i /> Private conversation with {counterparty.displayName}
                </small>
                <small aria-live="polite">
                  {realtimeConnected ? "Live updates connected" : "Reconnecting live updates…"}
                </small>
              </div>
              <button onClick={() => void refresh()}>Refresh</button>
            </div>
            <div className="web-messages">
              {messages.length ? (
                messages.map((message, index) => {
                  const previousMessage = messages[index - 1];
                  const startsNewDay =
                    !previousMessage ||
                    campusDateKey(new Date(previousMessage.createdAt)) !==
                      campusDateKey(new Date(message.createdAt));

                  return (
                    <Fragment key={message.id}>
                      <div className="web-message-date">
                        <time>
                          {startsNewDay
                            ? messageDateLabel(message.createdAt)
                            : messageTimeLabel(message.createdAt)}
                        </time>
                      </div>
                      <div className={message.isMine ? "mine" : ""}>
                        <i className="chat-avatar">
                          {message.isMine
                            ? "Y"
                            : message.sender.displayName
                                .charAt(0)
                                .toUpperCase()}
                        </i>
                        <span>
                          <b>
                            {message.isMine
                              ? "You"
                              : message.sender.displayName}
                          </b>
                          {message.body && <em>{message.body}</em>}
                          {message.attachments?.map((file) => (
                            <button
                              type="button"
                              className="chat-attachment"
                              key={file.id}
                              onClick={() =>
                                void downloadFile(file.id, file.originalName)
                              }
                            >
                              <strong>⇩ {file.originalName}</strong>
                              <small>
                                {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB
                              </small>
                            </button>
                          ))}
                          {message.isMine && index === messages.length - 1 && (
                            <small>{peerRead ? "Read" : "Sent"}</small>
                          )}
                        </span>
                      </div>
                    </Fragment>
                  );
                })
              ) : (
                <div className="workspace-chat-empty">
                  No messages yet. Start the conversation about this order.
                </div>
              )}
            </div>
            <form className="web-composer" onSubmit={send}>
              <label className="message-attach" title="Attach files">
                ＋
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.webp,.pdf,.zip,.docx,.xlsx"
                  onChange={(event) =>
                    setMessageFiles(
                      Array.from(event.target.files ?? []).slice(0, 3),
                    )
                  }
                />
                {messageFiles.length > 0 && <i>{messageFiles.length}</i>}
              </label>
              {messageFiles.length > 0 && (
                <div className="message-file-preview">
                  <span>
                    {messageFiles.map((file) => file.name).join(" · ")}
                  </span>
                  <button type="button" onClick={() => setMessageFiles([])}>
                    Clear
                  </button>
                </div>
              )}
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={2000}
                placeholder={
                  messageFiles.length
                    ? `${messageFiles.length} file(s) selected · Add a note…`
                    : "Write a message about this order…"
                }
              />
              <button
                disabled={(!draft.trim() && !messageFiles.length) || sending}
              >
                {sending ? "Sending…" : "Send →"}
              </button>
            </form>
          </main>
        </div>
      </div>
    </div>,
    document.body,
  );
}
