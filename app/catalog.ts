import type { Category } from "./types";

// Default Phase 1 marketplace taxonomy. The backend can later return updated
// categories while these keep a new installation useful and navigable.
export const defaultCategories: Category[] = [
  { id: "graphic-design", name: "Graphic Design", icon: "✦", serviceCount: 0, color: "coral" },
  { id: "tutoring", name: "Tutoring", icon: "A+", serviceCount: 0, color: "violet" },
  { id: "programming", name: "Programming", icon: "</>", serviceCount: 0, color: "blue" },
  { id: "photography", name: "Photography", icon: "◉", serviceCount: 0, color: "amber" },
  { id: "video-editing", name: "Video Editing", icon: "▶", serviceCount: 0, color: "mint" },
  { id: "writing", name: "Writing", icon: "Aa", serviceCount: 0, color: "pink" },
];
