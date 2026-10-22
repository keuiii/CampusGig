"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./brand";

type DialogTone = "default" | "danger";

type AlertOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: DialogTone;
};

type ConfirmOptions = AlertOptions & {
  cancelLabel?: string;
};

type PromptOptions = ConfirmOptions & {
  placeholder?: string;
  initialValue?: string;
  minLength?: number;
  maxLength?: number;
  validationMessage?: string;
};

type DialogRequest =
  | { kind: "alert"; options: AlertOptions; resolve: () => void }
  | {
      kind: "confirm";
      options: ConfirmOptions;
      resolve: (confirmed: boolean) => void;
    }
  | {
      kind: "prompt";
      options: PromptOptions;
      resolve: (value: string | null) => void;
    };

function dismissRequest(request: DialogRequest | null) {
  if (!request) return;
  if (request.kind === "alert") request.resolve();
  else if (request.kind === "confirm") request.resolve(false);
  else request.resolve(null);
}

export function useAppDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const requestRef = useRef<DialogRequest | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const present = useCallback((next: DialogRequest) => {
    dismissRequest(requestRef.current);
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    requestRef.current = next;
    setPromptValue(
      next.kind === "prompt" ? (next.options.initialValue ?? "") : "",
    );
    setRequest(next);
  }, []);

  const alert = useCallback(
    (options: AlertOptions) =>
      new Promise<void>((resolve) =>
        present({ kind: "alert", options, resolve }),
      ),
    [present],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        present({ kind: "confirm", options, resolve }),
      ),
    [present],
  );

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) =>
        present({ kind: "prompt", options, resolve }),
      ),
    [present],
  );

  const settle = useCallback((value: boolean | string | null = false) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    setRequest(null);
    if (current.kind === "alert") current.resolve();
    else if (current.kind === "confirm") current.resolve(value === true);
    else current.resolve(typeof value === "string" ? value : null);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  useEffect(
    () => () => {
      dismissRequest(requestRef.current);
      requestRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!request) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      if (request.kind === "prompt") promptRef.current?.focus();
      else confirmRef.current?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(request.kind === "alert" ? true : false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), textarea:not(:disabled)",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [request, settle]);

  const minimumLength =
    request?.kind === "prompt" ? (request.options.minLength ?? 1) : 0;
  const promptIsValid = promptValue.trim().length >= minimumLength;
  const options = request?.options;

  const dialog =
    request && options
      ? createPortal(
          <div
            className="app-dialog-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                settle(request.kind === "alert" ? true : false);
            }}
          >
            <section
              ref={dialogRef}
              className={`app-dialog app-dialog-${options.tone ?? "default"}`}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <span className="app-dialog-icon" aria-hidden="true">
                <Icon name={options.tone === "danger" ? "flag" : "check"} />
              </span>
              <div className="app-dialog-copy">
                <h2 id={titleId}>{options.title}</h2>
                <p id={descriptionId}>{options.message}</p>
              </div>
              {request.kind === "prompt" && (
                <label className="app-dialog-field">
                  <span>Reason or details</span>
                  <textarea
                    ref={promptRef}
                    value={promptValue}
                    placeholder={request.options.placeholder}
                    maxLength={request.options.maxLength ?? 1000}
                    onChange={(event) => setPromptValue(event.target.value)}
                  />
                  <small>
                    {promptIsValid
                      ? `${promptValue.length}/${request.options.maxLength ?? 1000}`
                      : (request.options.validationMessage ??
                        `Enter at least ${minimumLength} character${minimumLength === 1 ? "" : "s"}.`)}
                  </small>
                </label>
              )}
              <div className="app-dialog-actions">
                {request.kind !== "alert" && (
                  <button
                    type="button"
                    className="app-dialog-cancel"
                    onClick={() => settle(false)}
                  >
                    {request.options.cancelLabel ?? "Cancel"}
                  </button>
                )}
                <button
                  ref={confirmRef}
                  type="button"
                  className="app-dialog-confirm"
                  disabled={request.kind === "prompt" && !promptIsValid}
                  onClick={() =>
                    settle(
                      request.kind === "prompt" ? promptValue.trim() : true,
                    )
                  }
                >
                  {options.confirmLabel ??
                    (request.kind === "alert" ? "Got it" : "Confirm")}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  return { alert, confirm, prompt, dialog };
}
