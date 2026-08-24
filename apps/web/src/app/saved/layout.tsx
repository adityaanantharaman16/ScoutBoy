import type { Metadata } from "next";

// A segment layout purely so this route can declare its own title: the page
// itself is a client component and cannot export `metadata`. Every route needs a
// distinct, descriptive title (WCAG 2.2 SC 2.4.2 Page Titled).
export const metadata: Metadata = {
  title: "Saved - ScoutBoy",
  description:
    "Your saved players, saved Discovery views, and saved comparison setups, on this device or in your account.",
};

export default function SegmentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
