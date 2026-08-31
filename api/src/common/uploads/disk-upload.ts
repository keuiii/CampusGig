import { BadRequestException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { diskStorage } from "multer";

type UploadConfig = {
  folder: string;
  extensions: Record<string, string>;
  maxFileSize: number;
  maxFiles: number;
  invalidFileMessage: string;
  validate?: (file: Express.Multer.File) => string | null;
};

export function createDiskUploadOptions(config: UploadConfig) {
  const root = resolve(process.cwd(), "private-storage", config.folder);
  mkdirSync(root, { recursive: true });

  return {
    root,
    options: {
      storage: diskStorage({
        destination: root,
        filename: (
          _request: Express.Request,
          file: Express.Multer.File,
          callback: (error: Error | null, filename: string) => void,
        ) =>
          callback(null, `${randomUUID()}${config.extensions[file.mimetype]}`),
      }),
      limits: { fileSize: config.maxFileSize, files: config.maxFiles },
      fileFilter: (
        _request: Express.Request,
        file: Express.Multer.File,
        callback: (error: Error | null, accept: boolean) => void,
      ) => {
        const errorMessage =
          config.validate?.(file) ??
          (!config.extensions[file.mimetype]
            ? config.invalidFileMessage
            : null);
        if (errorMessage)
          return callback(new BadRequestException(errorMessage), false);
        callback(null, true);
      },
    },
  };
}
