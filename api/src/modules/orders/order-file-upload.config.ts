import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { diskStorage } from "multer";

export const orderFileStorageRoot = resolve(process.cwd(), "private-storage", "order-files");
mkdirSync(orderFileStorageRoot, { recursive: true });

const extensions: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf",
  "application/zip": ".zip", "application/x-zip-compressed": ".zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

export const orderFileUploadOptions = {
  storage: diskStorage({ destination: orderFileStorageRoot, filename: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, filename: string) => void) => callback(null, `${randomUUID()}${extensions[file.mimetype]}`) }),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (_request: Express.Request, file: Express.Multer.File, callback: (error: Error | null, accept: boolean) => void) => {
    if (!extensions[file.mimetype]) return callback(new BadRequestException("Deliverables must be JPG, PNG, WebP, PDF, ZIP, DOCX, or XLSX files"), false);
    callback(null, true);
  },
};
