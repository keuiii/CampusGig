"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { MfaSetup, MfaStatus } from "../../types";

export function MfaSecurityPanel({
  token,
  notify,
}: {
  token: string;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setStatus(await api.mfaStatus(token));
  }
  useEffect(() => {
    void refresh().catch((error) =>
      notify(
        error instanceof Error
          ? error.message
          : "Unable to load security settings",
      ),
    );
  }, [token]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Unable to update security settings",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status)
    return (
      <section className="mfa-security-card">
        Loading security settings…
      </section>
    );
  return (
    <section className="mfa-security-card">
      <div className="mfa-security-heading">
        <div>
          <span className="kicker">ACCOUNT SECURITY</span>
          <h2>Authenticator app</h2>
          <p>Add a second verification step when you sign in.</p>
        </div>
        <span className={`mfa-status ${status.enabled ? "enabled" : ""}`}>
          {status.enabled ? "Protected" : "Not enabled"}
        </span>
      </div>

      {!status.enabled && !setup && (
        <button
          className="primary-button"
          disabled={busy}
          onClick={() =>
            void run(async () => setSetup(await api.beginMfaSetup(token)))
          }
        >
          Set up authenticator
        </button>
      )}

      {setup && !status.enabled && (
        <div className="mfa-setup-grid">
          <img src={setup.qrCodeDataUrl} alt="Authenticator setup QR code" />
          <div>
            <h3>Scan this QR code</h3>
            <p>
              Use Google Authenticator, Microsoft Authenticator, or another TOTP
              app.
            </p>
            <small>Can’t scan it? Enter this setup key:</small>
            <code>{setup.secret}</code>
            <label>
              Current six-digit code
              <input
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <button
              className="primary-button"
              disabled={busy || code.length !== 6}
              onClick={() =>
                void run(async () => {
                  const result = await api.confirmMfaSetup(token, code);
                  setRecoveryCodes(result.recoveryCodes);
                  setSetup(null);
                  setCode("");
                  await refresh();
                  notify("Two-factor authentication is now enabled");
                })
              }
            >
              Verify and enable
            </button>
          </div>
        </div>
      )}

      {recoveryCodes.length > 0 && (
        <div className="mfa-recovery-box">
          <h3>Save your recovery codes now</h3>
          <p>
            Each code works once. Store them somewhere private; CampusGig will
            not show them again.
          </p>
          <div>
            {recoveryCodes.map((item) => (
              <code key={item}>{item}</code>
            ))}
          </div>
          <button
            className="outline-action"
            onClick={() =>
              void navigator.clipboard.writeText(recoveryCodes.join("\n"))
            }
          >
            Copy all codes
          </button>
        </div>
      )}

      {status.enabled && recoveryCodes.length === 0 && (
        <div className="mfa-enabled-actions">
          <p>{status.recoveryCodesRemaining} unused recovery codes remain.</p>
          <p>
            {status.trustedDeviceCount} device
            {status.trustedDeviceCount === 1 ? " is" : "s are"} currently
            trusted.
          </p>
          {status.trustedDeviceCount > 0 && (
            <button
              className="outline-action"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.revokeTrustedDevices(token);
                  window.localStorage.removeItem("campusgig.trustedDevice");
                  await refresh();
                  notify(
                    `${result.revoked} trusted device${result.revoked === 1 ? "" : "s"} removed`,
                  );
                })
              }
            >
              Sign out remembered devices
            </button>
          )}
          <label>
            Current authenticator code
            <input
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
            />
          </label>
          <button
            className="outline-action"
            disabled={busy || code.length !== 6}
            onClick={() =>
              void run(async () => {
                const result = await api.regenerateRecoveryCodes(token, code);
                setRecoveryCodes(result.recoveryCodes);
                setCode("");
                await refresh();
              })
            }
          >
            Replace recovery codes
          </button>
          {!status.required && (
            <div className="mfa-disable-row">
              <label>
                Current password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button
                className="outline-action danger"
                disabled={busy || code.length !== 6 || !password}
                onClick={() =>
                  void run(async () => {
                    await api.disableMfa(token, password, code);
                    setCode("");
                    setPassword("");
                    await refresh();
                    notify("Two-factor authentication disabled");
                  })
                }
              >
                Disable two-factor authentication
              </button>
            </div>
          )}
          {status.required && (
            <small>
              Two-factor authentication is required for administrator accounts.
            </small>
          )}
        </div>
      )}
    </section>
  );
}
