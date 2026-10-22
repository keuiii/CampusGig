import { createHash } from "node:crypto";

export type DeliveryFileEvidence = {
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
};

export function deliveryRequestFingerprint(
  note: string,
  files: readonly DeliveryFileEvidence[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        note: note.trim(),
        files: files.map((file) => ({
          originalName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          checksum: file.checksum,
        })),
      }),
    )
    .digest("hex");
}
