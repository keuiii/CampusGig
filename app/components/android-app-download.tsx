"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./brand";

export function AndroidAppDownload() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const showDialog = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled)',
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
  }, [closeDialog, open]);

  return (
    <>
      <button
        type="button"
        className="app-download-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={showDialog}
      >
        <Icon name="download" />
        <span>Get the app</span>
      </button>
      {open &&
        createPortal(
          <div
            className="android-download-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDialog();
            }}
          >
            <section
              ref={dialogRef}
              className="android-download-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            >
              <button
                ref={closeButtonRef}
                type="button"
                className="android-download-close"
                aria-label="Close app download dialog"
                onClick={closeDialog}
              >
                ×
              </button>
              <div className="android-download-copy">
                <span className="android-download-badge">ANDROID APP</span>
                <h2 id={titleId}>Take CampusGig anywhere.</h2>
                <p id={descriptionId}>
                  Install the official CampusGig Android app to manage your
                  profile, services, orders, and payments from your phone.
                </p>
                <div className="android-download-actions">
                  <a
                    className="android-download-button"
                    href="/downloads/campusgig-android.apk?v=1.0.4"
                    download
                  >
                    <Icon name="download" />
                    Download Android APK
                  </a>
                  <a
                    className="android-checksum-link"
                    href="/downloads/campusgig-android.apk.sha256"
                    download
                  >
                    Verify SHA-256 checksum
                  </a>
                </div>
                <ul
                  className="android-download-details"
                  aria-label="App details"
                >
                  <li>Version 1.0.4</li>
                  <li>Android 6.0 or newer</li>
                  <li>44.5 MB</li>
                </ul>
                <p className="android-install-note">
                  Android may ask you to allow installs from your browser. Only
                  download CampusGig from <strong>campusgig.net</strong>.
                </p>
              </div>
              <div className="android-download-qr">
                <div className="android-qr-frame">
                  <Image
                    src="/campusgig-download-qr.svg"
                    alt="QR code for downloading the CampusGig Android app"
                    width="210"
                    height="210"
                  />
                </div>
                <strong>Scan to download</strong>
                <span>Open with your Android camera</span>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
