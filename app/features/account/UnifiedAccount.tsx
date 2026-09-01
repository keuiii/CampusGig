"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { AuthUser } from "../../types";

export function UnifiedAccount({
  onAuthenticated,
}: {
  onAuthenticated: (token: string, user: AuthUser) => void;
}) {
  const [mode, setMode] = useState<
    "login" | "register" | "verify" | "forgot" | "reset" | "mfa"
  >("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaChallenge, setMfaChallenge] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [resetMfaCode, setResetMfaCode] = useState("");
  const [resetUsesRecovery, setResetUsesRecovery] = useState(false);
  const [isStudent, setIsStudent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const googleButton = useRef<HTMLDivElement>(null);
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  useEffect(() => {
    if (
      !googleClientId ||
      !googleButton.current ||
      (mode !== "login" && mode !== "register")
    )
      return;
    const startGoogle = () => {
      const google = (
        window as unknown as {
          google?: {
            accounts: {
              id: {
                initialize: (input: {
                  client_id: string;
                  callback: (result: { credential: string }) => void;
                }) => void;
                renderButton: (
                  element: HTMLElement,
                  options: Record<string, unknown>,
                ) => void;
              };
            };
          };
        }
      ).google;
      if (!google || !googleButton.current) return;
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setSubmitting(true);
          setError("");
          try {
            const session = await api.socialLogin(
              "GOOGLE",
              credential,
              window.localStorage.getItem("campusgig.trustedDevice") ??
                undefined,
            );
            finishAuthentication(session);
          } catch (caught) {
            setError(
              caught instanceof Error
                ? caught.message
                : "Google sign-in failed",
            );
          } finally {
            setSubmitting(false);
          }
        },
      });
      google.accounts.id.renderButton(googleButton.current, {
        theme: "outline",
        type: "icon",
        size: "large",
        shape: "circle",
      });
    };
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-campusgig-google]",
    );
    if (existing) {
      startGoogle();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.campusgigGoogle = "true";
    script.onload = startGoogle;
    document.head.appendChild(script);
  }, [googleClientId, mode, onAuthenticated]);
  function finishAuthentication(
    session: Awaited<ReturnType<typeof api.login>>,
  ) {
    if ("requiresTwoFactor" in session) {
      window.localStorage.removeItem("campusgig.trustedDevice");
      setMfaChallenge(session.challengeToken);
      setMode("mfa");
      setCode("");
      setNotice("Open your authenticator app and enter the current code.");
      return;
    }
    if (session.trustedDeviceToken)
      window.localStorage.setItem(
        "campusgig.trustedDevice",
        session.trustedDeviceToken,
      );
    onAuthenticated(session.accessToken, session.user);
  }
  function switchMode(
    next: "login" | "register" | "verify" | "forgot" | "reset" | "mfa",
  ) {
    if (next === mode) return;
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setCode("");
    setShowPassword(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (mode === "login") {
        const session = await api.login(
          email.trim(),
          password,
          window.localStorage.getItem("campusgig.trustedDevice") ?? undefined,
        );
        finishAuthentication(session);
      } else if (mode === "register") {
        const result = await api.register(
          displayName.trim(),
          email.trim(),
          password,
          isStudent,
        );
        setMode("verify");
        setCode(result.developmentCode ?? "");
        setNotice(
          result.developmentCode
            ? "Development mode: your test code is filled in below."
            : "Check your inbox for your six-digit verification code.",
        );
      } else if (mode === "verify") {
        const session = await api.verifyEmail(email.trim(), code);
        finishAuthentication(session);
      } else if (mode === "forgot") {
        const result = await api.forgotPassword(email.trim());
        setMode("reset");
        setCode(result.developmentCode ?? "");
        setNotice(
          result.developmentCode
            ? "Development mode: your test reset code is filled in below."
            : result.message,
        );
      } else if (mode === "reset") {
        const result = await api.resetPassword(
          email.trim(),
          code,
          password,
          resetMfaCode || undefined,
          resetUsesRecovery,
        );
        setNotice(result.message);
        setMode("login");
        setCode("");
        setPassword("");
      } else {
        const session = await api.verifyMfaChallenge(
          mfaChallenge,
          code,
          useRecoveryCode,
          rememberDevice,
        );
        finishAuthentication(session);
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to continue.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  const title =
    mode === "login"
      ? "Welcome back"
      : mode === "register"
        ? "Create your account"
        : mode === "verify"
          ? "Verify your email"
          : mode === "forgot"
            ? "Forgot your password?"
            : mode === "reset"
              ? "Create a new password"
              : "Two-factor verification";
  const description =
    mode === "verify"
      ? `Enter the code sent to ${email}.`
      : mode === "forgot"
        ? "Enter your account email and we’ll send a reset code."
        : mode === "reset"
          ? "Enter the six-digit code and your new password."
          : mode === "mfa"
            ? useRecoveryCode
              ? "Enter one of the recovery codes you saved when setting up two-factor authentication."
              : "Enter the six-digit code from your authenticator app."
            : mode === "login"
              ? "CampusGig will automatically open the workspace allowed for your account."
              : "Create a Client account. Select Student only if you attend a participating school.";
  const formReady =
    mode === "mfa"
      ? useRecoveryCode
        ? code.replace(/[^a-zA-Z0-9]/g, "").length === 10
        : code.length === 6
      : mode === "verify"
        ? code.length === 6
        : mode === "forgot"
          ? email.trim().includes("@")
          : mode === "reset"
            ? code.length === 6 && password.length >= 8
            : email.trim().includes("@") &&
              password.length >= 8 &&
              (mode === "login" || displayName.trim().length >= 2);
  return (
    <main className="admin-login-page">
      <section className="admin-login-card unified-auth-card">
        <div className="admin-login-mark">C</div>
        <span className="kicker">ONE CAMPUSGIG ACCOUNT</span>
        <div key={`intro-${mode}`} className="auth-copy-transition">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {(mode === "login" || mode === "register") && (
          <div className={`web-auth-tabs ${mode}`}>
            <span className="web-auth-slider" />
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => switchMode("login")}
            >
              Log in
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => switchMode("register")}
            >
              Sign up
            </button>
          </div>
        )}
        <form key={mode} className="auth-form-transition" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Full name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                minLength={2}
                maxLength={80}
                required
                autoComplete="name"
              />
            </label>
          )}
          {mode !== "verify" && (
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </label>
          )}
          {mode === "register" && (
            <label className="student-choice">
              <input
                type="checkbox"
                checked={isStudent}
                onChange={(event) => setIsStudent(event.target.checked)}
              />
              <span>
                <b>I’m currently a student</b>
                <small>
                  Select this only if you attend a participating school and want
                  school verification or future provider access.
                </small>
              </span>
            </label>
          )}
          {(mode === "verify" || mode === "reset" || mode === "mfa") && (
            <label>
              {mode === "mfa" && useRecoveryCode
                ? "Recovery code"
                : mode === "mfa"
                  ? "Authenticator code"
                  : "Six-digit code"}
              <input
                className="verification-code-input"
                value={code}
                onChange={(event) =>
                  setCode(
                    mode === "mfa" && useRecoveryCode
                      ? event.target.value.toUpperCase().slice(0, 11)
                      : event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                inputMode={useRecoveryCode ? "text" : "numeric"}
                pattern={useRecoveryCode ? undefined : "[0-9]{6}"}
                maxLength={useRecoveryCode ? 11 : 6}
                required
                autoComplete="one-time-code"
              />
            </label>
          )}
          {mode === "mfa" && (
            <label className="student-choice trusted-device-choice">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(event) => setRememberDevice(event.target.checked)}
              />
              <span>
                <b>Trust this device for 30 days</b>
                <small>
                  Don’t ask for a code again on this browser until the trust
                  expires.
                </small>
              </span>
            </label>
          )}
          {mode === "mfa" && (
            <button
              type="button"
              className="auth-text-button"
              onClick={() => {
                setUseRecoveryCode((value) => !value);
                setCode("");
                setError("");
              }}
            >
              {useRecoveryCode
                ? "Use authenticator app instead"
                : "Use a recovery code"}
            </button>
          )}
          {(mode === "login" || mode === "register" || mode === "reset") && (
            <label>
              {mode === "reset" ? "New password" : "Password"}
              <div className="web-password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </label>
          )}
          {(mode === "register" || mode === "reset") && (
            <div
              className={`web-password-rule ${password.length >= 8 ? "ready" : ""}`}
            >
              <span>{password.length >= 8 ? "✓" : "○"}</span> Minimum 8
              characters
            </div>
          )}
          {mode === "reset" && (
            <label>
              {resetUsesRecovery ? "Recovery code" : "Authenticator code"} (only
              if enabled)
              <input
                value={resetMfaCode}
                onChange={(event) =>
                  setResetMfaCode(
                    resetUsesRecovery
                      ? event.target.value.toUpperCase().slice(0, 11)
                      : event.target.value.replace(/\D/g, "").slice(0, 6),
                  )
                }
                placeholder={resetUsesRecovery ? "ABCDE-12345" : "Optional"}
              />
              <button
                type="button"
                className="auth-text-button"
                onClick={() => {
                  setResetUsesRecovery((value) => !value);
                  setResetMfaCode("");
                }}
              >
                {resetUsesRecovery
                  ? "Use authenticator code"
                  : "Use recovery code"}
              </button>
            </label>
          )}
          {notice && <div className="auth-notice">{notice}</div>}
          {error && <div className="admin-login-error">{error}</div>}
          <button
            className="primary-button wide"
            disabled={submitting || !formReady}
          >
            {submitting
              ? "Please wait…"
              : mode === "login"
                ? "Continue to CampusGig"
                : mode === "register"
                  ? `Create ${isStudent ? "student" : "client"} account`
                  : mode === "verify"
                    ? "Verify and continue"
                    : mode === "forgot"
                      ? "Send reset code"
                      : mode === "reset"
                        ? "Update password"
                        : "Verify and sign in"}
          </button>
        </form>
        {(mode === "login" || mode === "register") && (
          <div className="social-auth social-auth-below">
            <span>or continue with</span>
            <div ref={googleButton} className="google-signin-slot">
              {!googleClientId && (
                <button
                  type="button"
                  className="social-login-disabled compact"
                  disabled
                  aria-label="Google sign-in unavailable"
                >
                  G
                </button>
              )}
            </div>
          </div>
        )}
        {mode === "login" && (
          <button
            className="auth-text-button"
            onClick={() => switchMode("forgot")}
          >
            Forgot password?
          </button>
        )}
        {(mode === "forgot" ||
          mode === "reset" ||
          mode === "verify" ||
          mode === "mfa") && (
          <button
            className="auth-text-button"
            onClick={() => switchMode("login")}
          >
            ← Back to login
          </button>
        )}
        <small>
          School-provided email is optional. Your account email is never shown
          publicly.
        </small>
      </section>
    </main>
  );
}
