import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { diskStorage } from "multer";

export const avatarStorageRoot = resolve(process.cwd(), "private-storage", "avatars");
mkdirSync(avatarStorageRoot, { recursive: true });

const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png" };

export const avatarUploadOptions = {
  storage: diskStorage({
    destination: avatarStorageRoot,
    filename: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => callback(null, `${randomUUID()}${extensions[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) => {
    if (!extensions[file.mimetype]) return callback(new BadRequestException("Profile picture must be a JPG or PNG image"), false);
    callback(null, true);
  },
};
