import type { ProviderServiceStatus } from "../../types";

export type ProviderServiceAction =
  | "preview"
  | "edit"
  | "submit"
  | "pause"
  | "resume"
  | "archive"
  | "restore";

export function providerServiceActions(
  status: ProviderServiceStatus,
): ProviderServiceAction[] {
  switch (status) {
    case "DRAFT":
    case "REJECTED":
      return ["preview", "edit", "submit"];
    case "PENDING_REVIEW":
      return ["preview"];
    case "PUBLISHED":
      return ["preview", "edit", "pause", "archive"];
    case "PAUSED":
      return ["preview", "edit", "resume", "archive"];
    case "ARCHIVED":
      return ["preview", "restore"];
  }
}

export function providerServiceStatusCopy(status: ProviderServiceStatus) {
  switch (status) {
    case "DRAFT":
      return "Private draft";
    case "PENDING_REVIEW":
      return "Awaiting admin review";
    case "PUBLISHED":
      return "Visible in marketplace; editing creates a private draft";
    case "PAUSED":
      return "Hidden until you resume it; editing creates a private draft";
    case "REJECTED":
      return "Update the listing using the admin feedback";
    case "ARCHIVED":
      return "Stored privately and hidden from clients";
  }
}
