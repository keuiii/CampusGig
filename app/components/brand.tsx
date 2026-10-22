"use client";

import Image from "next/image";
import type { ReactNode } from "react";

type IconName =
  | "search"
  | "bell"
  | "arrow"
  | "check"
  | "clock"
  | "refresh"
  | "card"
  | "download"
  | "flag"
  | "exit";

export function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <button
      className="logo"
      onClick={onClick ?? (() => location.reload())}
      aria-label="CampusGig home"
    >
      <Image
        className="logo-mark"
        src="/brand/campusgig-mark.svg"
        alt=""
        width={42}
        height={42}
      />
      <span className="logo-wordmark" aria-hidden="true">
        <span className="logo-campus">Campus</span>
        <span className="logo-gig">Gig</span>
      </span>
    </button>
  );
}

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 1 0-2.34 5.66" />
        <path d="M20 4v7h-7" />
      </>
    ),
    card: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h3" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    flag: (
      <>
        <path d="M5 21V4" />
        <path d="M5 5h11l-2 4 2 4H5" />
      </>
    ),
    exit: (
      <>
        <path d="M10 5H5v14h5" />
        <path d="M13 8l4 4-4 4" />
        <path d="M8 12h9" />
      </>
    ),
  };

  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
