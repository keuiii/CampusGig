import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

@Injectable()
export class PayoutDestinationCipherService {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);

    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  decrypt(value: string) {
    const parts = value.split(".");
    if (parts.length !== 3)
      throw new Error("Invalid payout destination ciphertext");
    const [iv, tag, encrypted] = parts.map((part) =>
      Buffer.from(part, "base64url"),
    );
    if (iv.length !== 12 || tag.length !== 16 || !encrypted.length)
      throw new Error("Invalid payout destination ciphertext");
    const decipher = createDecipheriv("aes-256-gcm", this.key(), iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8");
  }

  private key() {
    const configured = this.config.get<string>(
      "PAYOUT_DESTINATION_ENCRYPTION_KEY",
    );
    if (!configured)
      throw new Error("PAYOUT_DESTINATION_ENCRYPTION_KEY is required");

    return createHash("sha256").update(configured).digest();
  }
}
