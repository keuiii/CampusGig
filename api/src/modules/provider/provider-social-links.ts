import { BadRequestException } from "@nestjs/common";

export type ProviderSocialLinkInput = {
  instagramUrl?: string | null;
  linkedinUrl?: string | null;
  xUrl?: string | null;
  portfolioUrl?: string | null;
};

const allowedHosts = {
  instagramUrl: ["instagram.com"],
  linkedinUrl: ["linkedin.com"],
  xUrl: ["x.com", "twitter.com"],
} as const;

function normalizeUrl(
  value: string | null | undefined,
  label: string,
  hosts?: readonly string[],
) {
  if (value === null || value === undefined || !value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new BadRequestException(`${label} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:")
    throw new BadRequestException(`${label} must use HTTPS`);
  if (
    hosts &&
    !hosts.some(
      (host) =>
        parsed.hostname === host || parsed.hostname.endsWith(`.${host}`),
    )
  )
    throw new BadRequestException(`${label} uses an unexpected domain`);
  parsed.hash = "";
  return parsed.toString();
}

export function normalizeProviderSocialLinks(input: ProviderSocialLinkInput) {
  return {
    instagramUrl: normalizeUrl(
      input.instagramUrl,
      "Instagram link",
      allowedHosts.instagramUrl,
    ),
    linkedinUrl: normalizeUrl(
      input.linkedinUrl,
      "LinkedIn link",
      allowedHosts.linkedinUrl,
    ),
    xUrl: normalizeUrl(input.xUrl, "X link", allowedHosts.xUrl),
    portfolioUrl: normalizeUrl(input.portfolioUrl, "Portfolio link"),
  };
}
