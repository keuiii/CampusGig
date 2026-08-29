import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { diskStorage } from "multer";

export const verificationStorageRoot = resolve(process.cwd(), "private-storage", "student-ids");
mkdirSync(verificationStorageRoot, { recursive: true });

const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);
const extensionByType: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" };

export const verificationUploadOptions = {
  storage: diskStorage({
    destination: verificationStorageRoot,
    filename: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => {
      callback(null, `${randomUUID()}${extensionByType[file.mimetype]}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    if (!allowedTypes.has(file.mimetype)) return callback(new BadRequestException("Student ID must be a JPG, PNG, or PDF"), false);
    callback(null, true);
  },
};
