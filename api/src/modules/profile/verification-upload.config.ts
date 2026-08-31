import { createDiskUploadOptions } from "../../common/uploads/disk-upload";

const upload = createDiskUploadOptions({
  folder: "student-ids",
  extensions: {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "application/pdf": ".pdf",
  },
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 1,
  invalidFileMessage: "Student ID must be a JPG, PNG, or PDF",
});

export const verificationStorageRoot = upload.root;
export const verificationUploadOptions = upload.options;
