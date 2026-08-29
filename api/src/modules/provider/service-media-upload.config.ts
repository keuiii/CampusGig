import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { diskStorage } from "multer";

export const serviceMediaStorageRoot = resolve(process.cwd(), "private-storage", "service-media");
mkdirSync(serviceMediaStorageRoot, { recursive: true });

const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };

export const serviceMediaUploadOptions = {
  storage: diskStorage({
    destination: serviceMediaStorageRoot,
    filename: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => callback(null, `${randomUUID()}${extensions[file.mimetype]}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) => {
    const allowed = file.fieldname === "cover" ? new Set(["image/jpeg", "image/png", "image/webp"]) : new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
    if (!allowed.has(file.mimetype)) return callback(new BadRequestException(file.fieldname === "cover" ? "Cover must be a JPG, PNG, or WebP image" : "Portfolio files must be JPG, PNG, WebP, or PDF"), false);
    callback(null, true);
  },
};
