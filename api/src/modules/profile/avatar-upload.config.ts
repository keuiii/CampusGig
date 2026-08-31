import { createDiskUploadOptions } from "../../common/uploads/disk-upload";

const upload = createDiskUploadOptions({
  folder: "avatars",
  extensions: { "image/jpeg": ".jpg", "image/png": ".png" },
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 1,
  invalidFileMessage: "Profile picture must be a JPG or PNG image",
});

export const avatarStorageRoot = upload.root;
export const avatarUploadOptions = upload.options;
