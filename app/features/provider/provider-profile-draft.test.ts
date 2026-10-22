import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderProfile } from "../../types";
import {
  emptyProviderProfileDraft,
  isProviderProfileDraftDirty,
  providerProfileToDraft,
  reconcileProviderProfileRefresh,
} from "./provider-profile-draft";

const profile = (bio = "Saved provider biography"): ProviderProfile => ({
  userId: "provider-1",
  headline: "Student designer",
  bio,
  skills: ["Figma", "Illustration"],
  isAvailable: true,
  maxActiveOrders: 5,
  maxPendingOrders: 50,
  instagramUrl: null,
  linkedinUrl: null,
  xUrl: null,
  portfolioUrl: null,
});

test("clean editor applies a remote provider update", () => {
  const saved = profile();
  const incoming = profile("Updated remotely");
  const result = reconcileProviderProfileRefresh({
    savedProfile: saved,
    draft: providerProfileToDraft(saved),
    incomingProfile: incoming,
    initialized: true,
  });

  assert.equal(result.kind, "apply");
  if (result.kind === "apply") assert.equal(result.draft.bio, incoming.bio);
});

test("untouched new-profile editor accepts its first remote profile", () => {
  const incoming = profile("Created on mobile");
  const result = reconcileProviderProfileRefresh({
    savedProfile: null,
    draft: emptyProviderProfileDraft(),
    incomingProfile: incoming,
    initialized: true,
  });

  assert.equal(result.kind, "apply");
  if (result.kind === "apply") assert.equal(result.draft.bio, incoming.bio);
});

test("dirty editor preserves its draft and records the remote update", () => {
  const saved = profile();
  const draft = { ...providerProfileToDraft(saved), bio: "Unsaved local bio" };
  const incoming = profile("Updated remotely");
  const result = reconcileProviderProfileRefresh({
    savedProfile: saved,
    draft,
    incomingProfile: incoming,
    initialized: true,
  });

  assert.deepEqual(result, { kind: "preserve", pendingProfile: incoming });
  assert.equal(draft.bio, "Unsaved local bio");
});

test("explicit reload intentionally replaces a dirty draft", () => {
  const saved = profile();
  const incoming = profile("Latest authoritative bio");
  const result = reconcileProviderProfileRefresh({
    savedProfile: saved,
    draft: { ...providerProfileToDraft(saved), bio: "Unsaved local bio" },
    incomingProfile: incoming,
    initialized: true,
    force: true,
  });

  assert.equal(result.kind, "apply");
  if (result.kind === "apply") {
    assert.equal(result.draft.bio, incoming.bio);
    assert.equal(
      isProviderProfileDraftDirty(result.profile, result.draft),
      false,
    );
  }
});

test("successful save resets dirty state and later remote updates apply", () => {
  const saved = profile("Locally saved bio");
  const savedDraft = providerProfileToDraft(saved);
  assert.equal(isProviderProfileDraftDirty(saved, savedDraft), false);

  const incoming = profile("Later remote bio");
  const result = reconcileProviderProfileRefresh({
    savedProfile: saved,
    draft: savedDraft,
    incomingProfile: incoming,
    initialized: true,
  });
  assert.equal(result.kind, "apply");
});

test("multiple remote invalidations preserve the same local draft", () => {
  const saved = profile();
  const draft = { ...providerProfileToDraft(saved), headline: "Local draft" };
  const first = reconcileProviderProfileRefresh({
    savedProfile: saved,
    draft,
    incomingProfile: profile("First remote bio"),
    initialized: true,
  });
  const latest = profile("Latest remote bio");
  const second = reconcileProviderProfileRefresh({
    savedProfile: saved,
    draft,
    incomingProfile: latest,
    initialized: true,
  });

  assert.equal(first.kind, "preserve");
  assert.deepEqual(second, { kind: "preserve", pendingProfile: latest });
  assert.equal(draft.headline, "Local draft");
});

test("unsaved social links participate in dirty draft protection", () => {
  const saved = profile();
  const draft = {
    ...providerProfileToDraft(saved),
    portfolioUrl: "https://portfolio.example/student",
  };

  assert.equal(isProviderProfileDraftDirty(saved, draft), true);
});

test("unsaved workload limits participate in dirty draft protection", () => {
  const saved = profile();
  const draft = {
    ...providerProfileToDraft(saved),
    maxActiveOrders: 8,
    maxPendingOrders: 30,
  };

  assert.equal(isProviderProfileDraftDirty(saved, draft), true);
});
