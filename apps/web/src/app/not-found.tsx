import type { Metadata } from "next";
import Link from "next/link";

// Next's built-in 404 renders a bare "404" heading inside the root layout, which
// left the browser title reporting "ScoutBoy — player discovery" (WCAG 2.2
// SC 2.4.2) and offered no explanation or recovery path. This replaces it with
// the product's own honest not-found state, matching the copy discipline used by
// every other unavailable state: say what is unavailable, do not invent a cause,
// and keep a way forward.
export const metadata: Metadata = {
  title: "Page Not Found - ScoutBoy",
  description: "The requested ScoutBoy page does not exist.",
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-10" data-testid="not-found">
      <p className="label mb-1">Not found</p>
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
        Page Not Found
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        This page does not exist. It may have been renamed, or the address may be incorrect. No
        player data was affected.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/" className="btn btn-primary no-underline" data-testid="not-found-discover">
          Back to discover
        </Link>
        <Link href="/methodology" className="btn no-underline">
          Read the methodology
        </Link>
      </div>
    </div>
  );
}
