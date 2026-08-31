import { createDiskUploadOptions } from "../../common/uploads/disk-upload";

const upload = createDiskUploadOptions({
  folder: "order-files",
  extensions: {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/x-zip-compressed": ".zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
  },
  maxFileSize: 15 * 1024 * 1024,
  maxFiles: 5,
  invalidFileMessage:
    "Deliverables must be JPG, PNG, WebP, PDF, ZIP, DOCX, or XLSX files",
});

export const orderFileStorageRoot = upload.root;
export const orderFileUploadOptions = upload.options;
