import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { normalizeProviderSocialLinks } from "../src/modules/provider/provider-social-links";

test("provider social links accept only HTTPS and expected social domains", () => {
  const links = normalizeProviderSocialLinks({
    instagramUrl: "https://instagram.com/campusgig#profile",
    linkedinUrl: "https://ph.linkedin.com/in/campusgig",
    xUrl: "https://x.com/campusgig",
    portfolioUrl: "https://portfolio.example/student",
  });

  assert.equal(links.instagramUrl, "https://instagram.com/campusgig");
  assert.equal(links.linkedinUrl, "https://ph.linkedin.com/in/campusgig");
  assert.equal(links.xUrl, "https://x.com/campusgig");
  assert.equal(links.portfolioUrl, "https://portfolio.example/student");
});

test("provider social links reject unsafe schemes and mislabeled domains", () => {
  assert.throws(
    () => normalizeProviderSocialLinks({ portfolioUrl: "javascript:alert(1)" }),
    BadRequestException,
  );
  assert.throws(
    () =>
      normalizeProviderSocialLinks({
        instagramUrl: "https://not-instagram.example/profile",
      }),
    BadRequestException,
  );
});
