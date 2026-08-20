/**
 * Whether this build has an identity provider at all.
 *
 * Accounts are OPTIONAL in two different senses, and this module is where the
 * second one lives: an individual visitor may choose not to have one, and an
 * entire deployment may choose not to offer them. With no Clerk configuration
 * present, ScoutBoy is exactly the anonymous product it was before Milestone
 * 8.4A: Discovery, dossiers, leaderboards, Compare and Methodology are public,
 * favourites are browser-local, and no sign-in affordance is rendered anywhere.
 *
 * `process.env.NEXT_PUBLIC_*` is inlined by the compiler, so both branches are
 * decided at build time and the disabled build never carries a live Clerk
 * provider. The reads below are deliberately written as full static property
 * accesses rather than destructured or computed lookups, because that is the
 * form Next.js's inliner recognises.
 */

/** Set to "0"/"false" to keep accounts off even when a key happens to be present. */
const EXPLICIT_SWITCH = process.env.NEXT_PUBLIC_SCOUTBOY_AUTH_ENABLED;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const OFF_VALUES = new Set(["0", "false", "off", "no"]);
const ON_VALUES = new Set(["1", "true", "on", "yes"]);

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Resolved once at module load so every surface agrees, and so a misconfiguration
 * fails at build/boot rather than on whichever page happens to read it first.
 *
 * Three states, not two:
 *   - explicitly OFF          -> disabled, whatever else is set
 *   - explicitly ON, no key   -> throw. This is the "internally inconsistent
 *                                configuration" case: silently falling back to
 *                                anonymous would hide a broken deploy from the
 *                                operator who deliberately asked for accounts.
 *   - unset                   -> enabled iff a publishable key is present
 */
function resolveEnabled(): boolean {
  const explicit = normalize(EXPLICIT_SWITCH);
  const key = (PUBLISHABLE_KEY ?? "").trim();

  if (OFF_VALUES.has(explicit)) return false;
  if (ON_VALUES.has(explicit)) {
    if (!key) {
      throw new Error(
        "NEXT_PUBLIC_SCOUTBOY_AUTH_ENABLED is set but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing. " +
          "Set the publishable key, or unset the switch to run ScoutBoy anonymously.",
      );
    }
    return true;
  }
  return key.length > 0;
}

export const AUTH_ENABLED: boolean = resolveEnabled();

/**
 * The publishable key, only ever read when auth is enabled.
 *
 * Publishable by design: it identifies the Clerk instance to the browser and is
 * meant to ship in the bundle. The SECRET key has no counterpart here and must
 * never be given a `NEXT_PUBLIC_` name; nothing in `src/` reads one.
 */
export const CLERK_PUBLISHABLE_KEY: string = (PUBLISHABLE_KEY ?? "").trim();
