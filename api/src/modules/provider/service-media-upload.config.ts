import { createDiskUploadOptions } from "../../common/uploads/disk-upload";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const upload = createDiskUploadOptions({
  folder: "service-media",
  extensions: {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
  },
  maxFileSize: 8 * 1024 * 1024,
  maxFiles: 6,
  invalidFileMessage: "Portfolio files must be JPG, PNG, WebP, or PDF",
  validate: (file) =>
    file.fieldname === "cover" && !imageTypes.has(file.mimetype)
      ? "Cover must be a JPG, PNG, or WebP image"
      : null,
});

export const serviceMediaStorageRoot = upload.root;
export const serviceMediaUploadOptions = upload.options;
