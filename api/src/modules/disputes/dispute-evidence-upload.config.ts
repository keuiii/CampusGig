import { createDiskUploadOptions } from "../../common/uploads/disk-upload";

const upload = createDiskUploadOptions({
  folder: "dispute-evidence",
  extensions: {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  },
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 5,
  invalidFileMessage: "Dispute evidence must be a JPG, PNG, WebP, or PDF file",
});

export const disputeEvidenceUploadOptions = upload.options;
