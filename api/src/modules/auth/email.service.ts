import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(private readonly config: ConfigService) {}

  async sendCode(
    email: string,
    code: string,
    purpose: "VERIFY_EMAIL" | "RESET_PASSWORD",
  ) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    const from = this.config.get<string>("EMAIL_FROM");
    const smtpUser = this.config.get<string>("SMTP_USER");
    const smtpPass = this.config.get<string>("SMTP_APP_PASSWORD");
    const subject =
      purpose === "VERIFY_EMAIL"
        ? "Verify your CampusGig account"
        : "Reset your CampusGig password";
    const intro =
      purpose === "VERIFY_EMAIL"
        ? "Use this code to verify your new CampusGig account."
        : "Use this code to reset your CampusGig password.";
    const text = `CampusGig\n\n${intro}\n\n${code}\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.`;
    const html = `<div style="font-family:Arial,sans-serif;color:#17211d"><h2>CampusGig</h2><p>${intro}</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`;

    if (smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: smtpUser, pass: smtpPass.replace(/\s/g, "") },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      await transporter
        .sendMail({
          from: from || `CampusGig <${smtpUser}>`,
          to: email,
          subject,
          text,
          html,
        })
        .catch(() => {
          throw new ServiceUnavailableException(
            "The verification email could not be sent. Check the Gmail app-password configuration.",
          );
        });
      return { delivered: true, provider: "gmail" };
    }

    if (!apiKey || !from) {
      if (this.config.get<string>("NODE_ENV") === "production")
        throw new ServiceUnavailableException(
          "Email delivery is not configured",
        );
      this.logger.warn(
        `Development email for ${email}: ${subject} — code ${code}`,
      );
      return { delivered: false };
    }
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        text,
        html,
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!response)
      throw new ServiceUnavailableException(
        "The verification email service is temporarily unavailable. Please try again.",
      );
    if (!response.ok)
      throw new ServiceUnavailableException(
        "The verification email could not be sent. Please try again.",
      );
    return { delivered: true, provider: "resend" };
  }

  async sendPasswordChanged(email: string, changedAt = new Date()) {
    const smtpUser = this.config.get<string>("SMTP_USER");
    const smtpPass = this.config.get<string>("SMTP_APP_PASSWORD");
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    const from = this.config.get<string>("EMAIL_FROM");
    const displayTime = changedAt.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });
    const subject = "Your CampusGig password was changed";
    const text = `CampusGig security notice\n\nYour password was changed on ${displayTime} (Philippine time).\n\nIf you made this change, no action is needed. If you did not, reset your password immediately and contact CampusGig support.`;
    const html = `<div style="font-family:Arial,sans-serif;color:#17211d;line-height:1.6"><h2>CampusGig security notice</h2><p>Your password was changed on <strong>${displayTime}</strong> (Philippine time).</p><p>If you made this change, no action is needed.</p><p style="padding:14px;border-radius:10px;background:#f4f7f5"><strong>Wasn’t you?</strong><br>Reset your password immediately and contact CampusGig support.</p></div>`;

    if (smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: smtpUser, pass: smtpPass.replace(/\s/g, "") },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      await transporter.sendMail({
        from: from || `CampusGig <${smtpUser}>`,
        to: email,
        subject,
        text,
        html,
      });
      return { delivered: true, provider: "gmail" };
    }

    if (!apiKey || !from) return { delivered: false };
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    return { delivered: Boolean(response?.ok), provider: "resend" };
  }

  async sendPasswordChangeReview(
    email: string,
    reviewUrl: string,
    expiresAt: Date,
  ) {
    const smtpUser = this.config.get<string>("SMTP_USER");
    const smtpPass = this.config.get<string>("SMTP_APP_PASSWORD");
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    const from = this.config.get<string>("EMAIL_FROM");
    const expiry = expiresAt.toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short",
    });
    const subject = "Confirm your CampusGig password change";
    const text = `A password change was requested for your CampusGig account. Review and approve or reject it before ${expiry} (Philippine time): ${reviewUrl}`;
    const html = `<div style="font-family:Arial,sans-serif;color:#17211d;line-height:1.6"><h2>Confirm your password change</h2><p>A password change was requested for your CampusGig account.</p><p>The password will not change until you approve this request.</p><p><a href="${reviewUrl}" style="display:inline-block;padding:12px 20px;border-radius:9px;background:#13795b;color:#fff;text-decoration:none;font-weight:700">Review password change</a></p><p>This request expires on ${expiry} (Philippine time). If you did not request it, open the review page and reject it.</p></div>`;
    if (smtpUser && smtpPass) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: smtpUser, pass: smtpPass.replace(/\s/g, "") },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });
      await transporter.sendMail({
        from: from || `CampusGig <${smtpUser}>`,
        to: email,
        subject,
        text,
        html,
      });
      return { delivered: true };
    }
    if (!apiKey || !from) return { delivered: false };
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [email], subject, text, html }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    return { delivered: Boolean(response?.ok) };
  }
}
