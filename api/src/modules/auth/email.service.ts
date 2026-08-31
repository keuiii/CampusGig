import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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
    const subject =
      purpose === "VERIFY_EMAIL"
        ? "Verify your CampusGig account"
        : "Reset your CampusGig password";
    const intro =
      purpose === "VERIFY_EMAIL"
        ? "Use this code to verify your new CampusGig account."
        : "Use this code to reset your CampusGig password.";
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
        html: `<div style="font-family:Arial,sans-serif;color:#17211d"><h2>CampusGig</h2><p>${intro}</p><p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request it, you can ignore this email.</p></div>`,
      }),
    });
    if (!response.ok)
      throw new ServiceUnavailableException(
        "The verification email could not be sent. Please try again.",
      );
    return { delivered: true };
  }
}
