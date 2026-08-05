import type { Metadata } from "next";

// A segment layout purely so this route can declare its own title: the page
// itself is a client component and cannot export `metadata`. Every route needs a
// distinct, descriptive title (WCAG 2.2 SC 2.4.2 Page Titled) — before the M7
// closeout every surface reported the root layout's "ScoutBoy — player
// discovery", which told a screen-reader or tab-switching user nothing about
// where they were.
export const metadata: Metadata = {
  title: "My Favorites - ScoutBoy",
  description: "Players saved on this device, with their stored RoleFit scores and market context.",
};

export default function SegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
