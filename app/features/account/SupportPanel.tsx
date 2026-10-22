"use client";

import { FormEvent, useState } from "react";
import { api } from "../../lib/api";
import type { SupportTicketCategory } from "../../types";

const categories: { value: SupportTicketCategory; label: string }[] = [
  { value: "TECHNICAL", label: "Technical issue" },
  { value: "ACCOUNT", label: "Account and access" },
  { value: "ORDER", label: "Order or delivery" },
  { value: "PAYMENT", label: "Payment" },
  { value: "SAFETY", label: "Safety concern" },
  { value: "OTHER", label: "Something else" },
];

export function SupportPanel({
  token,
  notify,
}: {
  token: string;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<SupportTicketCategory>("TECHNICAL");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reference, setReference] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const result = await api.createSupportTicket(token, {
        category,
        subject: subject.trim(),
        message: message.trim(),
        source: "WEB",
      });
      setReference(result.reference);
      setSubject("");
      setMessage("");
      notify(`${result.message} Reference: ${result.reference}`);
    } catch (caught) {
      notify(
        caught instanceof Error
          ? caught.message
          : "Unable to submit your support request",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="support-panel">
      <div className="support-panel-heading">
        <div>
          <span className="kicker">HELP AND SUPPORT</span>
          <h2>Report a problem</h2>
          <p>Send account, order, payment, safety, or technical details.</p>
        </div>
        <button
          type="button"
          className="outline-action"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : "Contact support"}
        </button>
      </div>
      {open ? (
        <form className="support-form" onSubmit={submit}>
          <label>
            Category
            <select
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as SupportTicketCategory)
              }
            >
              {categories.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Subject
            <input
              value={subject}
              minLength={5}
              maxLength={120}
              required
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Briefly describe the problem"
            />
          </label>
          <label>
            What happened?
            <textarea
              value={message}
              minLength={20}
              maxLength={2000}
              required
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Include what you expected, what happened, and any relevant order number."
            />
            <small>{message.length}/2000</small>
          </label>
          <button
            className="primary-button support-submit"
            disabled={
              submitting ||
              subject.trim().length < 5 ||
              message.trim().length < 20
            }
          >
            {submitting ? "Submitting…" : "Submit report"}
          </button>
          {reference ? (
            <p className="support-reference" role="status">
              Submitted · {reference}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
