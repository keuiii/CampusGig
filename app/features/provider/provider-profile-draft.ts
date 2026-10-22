import type { ProviderProfile } from "../../types";

export type ProviderProfileDraft = {
  headline: string;
  bio: string;
  skills: string;
  isAvailable: boolean;
  maxActiveOrders: number;
  maxPendingOrders: number;
  instagramUrl: string;
  linkedinUrl: string;
  xUrl: string;
  portfolioUrl: string;
};

export type ProviderProfileRefreshResult =
  | {
      kind: "apply";
      profile: ProviderProfile | null;
      draft: ProviderProfileDraft;
    }
  | {
      kind: "preserve";
      pendingProfile: ProviderProfile | null;
    };

export const emptyProviderProfileDraft = (): ProviderProfileDraft => ({
  headline: "",
  bio: "",
  skills: "",
  isAvailable: true,
  maxActiveOrders: 5,
  maxPendingOrders: 50,
  instagramUrl: "",
  linkedinUrl: "",
  xUrl: "",
  portfolioUrl: "",
});

export const providerProfileToDraft = (
  profile: ProviderProfile | null,
): ProviderProfileDraft =>
  profile
    ? {
        headline: profile.headline,
        bio: profile.bio,
        skills: profile.skills.join(", "),
        isAvailable: profile.isAvailable,
        maxActiveOrders: profile.maxActiveOrders,
        maxPendingOrders: profile.maxPendingOrders,
        instagramUrl: profile.instagramUrl ?? "",
        linkedinUrl: profile.linkedinUrl ?? "",
        xUrl: profile.xUrl ?? "",
        portfolioUrl: profile.portfolioUrl ?? "",
      }
    : emptyProviderProfileDraft();

const normalizedSkills = (skills: string) =>
  skills
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean)
    .join(", ");

export const isProviderProfileDraftDirty = (
  profile: ProviderProfile | null,
  draft: ProviderProfileDraft,
) =>
  !profile ||
  profile.headline !== draft.headline.trim() ||
  profile.bio !== draft.bio.trim() ||
  profile.skills.join(", ") !== normalizedSkills(draft.skills) ||
  profile.isAvailable !== draft.isAvailable ||
  profile.maxActiveOrders !== draft.maxActiveOrders ||
  profile.maxPendingOrders !== draft.maxPendingOrders ||
  (profile.instagramUrl ?? "") !== draft.instagramUrl.trim() ||
  (profile.linkedinUrl ?? "") !== draft.linkedinUrl.trim() ||
  (profile.xUrl ?? "") !== draft.xUrl.trim() ||
  (profile.portfolioUrl ?? "") !== draft.portfolioUrl.trim();

export const hasUnsavedProviderProfileDraft = (
  profile: ProviderProfile | null,
  draft: ProviderProfileDraft,
) =>
  profile
    ? isProviderProfileDraftDirty(profile, draft)
    : draft.headline.trim().length > 0 ||
      draft.bio.trim().length > 0 ||
      normalizedSkills(draft.skills).length > 0 ||
      !draft.isAvailable ||
      draft.maxActiveOrders !== 5 ||
      draft.maxPendingOrders !== 50 ||
      draft.instagramUrl.trim().length > 0 ||
      draft.linkedinUrl.trim().length > 0 ||
      draft.xUrl.trim().length > 0 ||
      draft.portfolioUrl.trim().length > 0;

export function reconcileProviderProfileRefresh({
  savedProfile,
  draft,
  incomingProfile,
  initialized,
  force = false,
}: {
  savedProfile: ProviderProfile | null;
  draft: ProviderProfileDraft;
  incomingProfile: ProviderProfile | null;
  initialized: boolean;
  force?: boolean;
}): ProviderProfileRefreshResult {
  if (
    force ||
    !initialized ||
    !hasUnsavedProviderProfileDraft(savedProfile, draft)
  ) {
    return {
      kind: "apply",
      profile: incomingProfile,
      draft: providerProfileToDraft(incomingProfile),
    };
  }

  return { kind: "preserve", pendingProfile: incomingProfile };
}
