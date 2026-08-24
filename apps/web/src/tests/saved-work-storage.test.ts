/**
 * Milestone 8.4B: canonical Discovery views and versioned device storage.
 *
 * Everything here is pure — no React, no network — because these are the rules
 * six different consumers have to agree about (the rail, the URL, saved-view
 * identity, reopening, device storage and the API contract). If they disagree, a
 * scout sees a "duplicate" saved view that is really the same cohort, or one that
 * reopens to a different ledger.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  discoveryViewFromFilters,
  discoveryViewFromParams,
  discoveryViewHref,
  discoveryViewIdentity,
  discoveryViewToParams,
  droppedFieldLabels,
  isEmptyDiscoveryView,
  recoverDiscoveryView,
  sameDiscoveryView,
  type DiscoveryView,
} from "@/lib/filters/canonical";
import {
  COLLECTION_VERSION,
  newClientId,
  readCollection,
  validClientId,
  validLabel,
  writeCollection,
} from "@/lib/storage/durable-collection";
import {
  SAVED_COMPARISONS_STORAGE_ID,
  SAVED_VIEWS_STORAGE_ID,
  makeSavedComparison,
  makeSavedView,
  readSavedComparisons,
  readSavedViews,
  savedComparisonIdentity,
  savedViewIdentity,
  upsertByIdentity,
  validateSavedComparison,
  validateSavedView,
  writeSavedComparisons,
  writeSavedViews,
} from "@/lib/storage/saved-work";

const UUID_A = "0f8fad5b-d9cb-469f-a165-70867728950e";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Canonical Discovery views
// ---------------------------------------------------------------------------

describe("Canonical Discovery views", () => {
  it("carries every representable filter, and nothing else", () => {
    const view = discoveryViewFromParams(
      params(
        "q=Anton&position_group=ATT&role=touchline_winger&league=Bundesliga&club=Stuttgart" +
          "&nationality=Germany&playstyle=technical_carrier&age_max=22&min_minutes=900" +
          "&rolefit_min=60&rolefit_max=95&value_min=1000000&value_max=25000000" +
          "&sort=rolefit_asc&page_size=24",
      ),
    );
    expect(view).toEqual({
      q: "Anton",
      position_group: "ATT",
      role: "touchline_winger",
      league: "Bundesliga",
      club: "Stuttgart",
      nationality: "Germany",
      playstyle: "technical_carrier",
      age_max: 22,
      min_minutes: 900,
      rolefit_min: 60,
      rolefit_max: 95,
      value_min: 1_000_000,
      value_max: 25_000_000,
      sort: "rolefit_asc",
      page_size: 24,
    });
  });

  it("omits defaults, so the root URL and its long spelling are ONE view", () => {
    const bare = discoveryViewFromParams(params(""));
    const spelled = discoveryViewFromParams(params("sort=rolefit_desc&page_size=12&page=1"));
    expect(bare).toEqual({});
    expect(spelled).toEqual({});
    expect(sameDiscoveryView(bare, spelled)).toBe(true);
    expect(isEmptyDiscoveryView(bare)).toBe(true);
  });

  it("never carries a page number, so a saved view always opens on page 1", () => {
    const view = discoveryViewFromParams(params("club=Ajax&page=7"));
    expect(view).not.toHaveProperty("page");
    expect(discoveryViewToParams(view).get("page")).toBeNull();
    expect(discoveryViewHref(view)).toBe("/?club=Ajax");
  });

  it("drops the retired Analysis Scope rather than persisting it", () => {
    const view = discoveryViewFromParams(params("club=Ajax&scope=all_records&universe=mvp"));
    expect(view).toEqual({ club: "Ajax" });
  });

  it("normalizes a legacy age_band into a snapped one-sided bound", () => {
    expect(discoveryViewFromParams(params("age_band=u23"))).toEqual({ age_max: 22 });
    expect(discoveryViewFromParams(params("age_band=31_plus"))).toEqual({ age_min: 31 });
    // An explicit bound wins over the legacy band.
    expect(discoveryViewFromParams(params("age_band=u23&age_min=28"))).toEqual({ age_min: 28 });
  });

  it("snaps an off-stop age bound, so the control and the view cannot disagree", () => {
    expect(discoveryViewFromParams(params("age_max=24"))).toEqual({ age_max: 25 });
    expect(discoveryViewFromParams(params("age_min=99"))).toEqual({ age_min: 31 });
  });

  it("makes an incoherent inclusive pair coherent, minimum authoritative", () => {
    expect(discoveryViewFromParams(params("rolefit_min=80&rolefit_max=20"))).toEqual({
      rolefit_min: 80,
      rolefit_max: 80,
    });
  });

  it("drops an unrepresentable enumerated value instead of forwarding it", () => {
    const view = discoveryViewFromParams(
      params("role=no_such_role&position_group=XYZ&sort=no_such_sort&club=Ajax"),
    );
    expect(view).toEqual({ club: "Ajax" });
  });

  it("round-trips: params to view to params is stable", () => {
    const query = "age_max=22&club=Stuttgart&q=Anton&role=advanced_8&sort=name_asc";
    const once = discoveryViewFromParams(params(query));
    const twice = discoveryViewFromParams(discoveryViewToParams(once));
    expect(twice).toEqual(once);
  });

  it("gives one identity to one cohort, whatever order the fields arrived in", () => {
    const a = discoveryViewFromParams(params("club=Ajax&role=advanced_8&age_max=22"));
    const b = discoveryViewFromParams(params("age_max=22&role=advanced_8&club=Ajax"));
    expect(discoveryViewIdentity(a)).toBe(discoveryViewIdentity(b));
    expect(sameDiscoveryView(a, b)).toBe(true);
  });

  it("gives DIFFERENT identities to different cohorts", () => {
    const a = discoveryViewFromParams(params("club=Ajax"));
    const b = discoveryViewFromParams(params("club=Bayern"));
    expect(sameDiscoveryView(a, b)).toBe(false);
  });

  it("treats a composed and a decomposed club name as one cohort", () => {
    // NFC vs NFD: visually identical, different code points. Built from explicit
    // escapes rather than literals, because an editor normalizing the file would
    // otherwise turn this into a comparison of one string with itself.
    const composed = "Köln"; // o-with-diaeresis, one code point
    const decomposed = "Köln"; // o + combining diaeresis
    expect(composed).not.toBe(decomposed);

    const a = discoveryViewFromParams(params(`club=${encodeURIComponent(composed)}`));
    const b = discoveryViewFromParams(params(`club=${encodeURIComponent(decomposed)}`));
    expect(sameDiscoveryView(a, b)).toBe(true);
    expect(a.club).toBe(composed);
  });

  it("trims outer whitespace but never internal spacing", () => {
    const view = discoveryViewFromParams(
      params(`club=${encodeURIComponent("  Paris Saint-Germain  ")}`),
    );
    expect(view.club).toBe("Paris Saint-Germain");
  });

  it("derives the same view from a live request as from its URL", () => {
    const fromFilters = discoveryViewFromFilters({
      q: "Anton",
      club: "Ajax",
      scope: "analyzed",
      sort: "rolefit_desc",
      page: 4,
      page_size: 12,
      age_max: 22,
    });
    const fromUrl = discoveryViewFromParams(params("q=Anton&club=Ajax&age_max=22"));
    expect(fromFilters).toEqual(fromUrl);
  });
});

// ---------------------------------------------------------------------------
// Stale-view recovery
// ---------------------------------------------------------------------------

describe("Stale saved-view recovery", () => {
  it("keeps every still-valid criterion and names only what was lost", () => {
    const { view, dropped } = recoverDiscoveryView({
      club: "Ajax",
      league: "Eredivisie",
      age_max: 22,
      role: "a_role_that_was_retired",
      sort: "a_sort_that_was_retired",
    });
    expect(view).toEqual({ club: "Ajax", league: "Eredivisie", age_max: 22 });
    expect(dropped.sort()).toEqual(["role", "sort"]);
    expect(droppedFieldLabels(dropped)).toEqual(["Role", "Sort"]);
  });

  it("never forwards an invalid value to the API", () => {
    const { view } = recoverDiscoveryView({ role: "gone", rolefit_min: 500, min_minutes: -4 });
    expect(discoveryViewToParams(view).toString()).toBe("");
  });

  it("recovers from a non-object, an array and a null", () => {
    for (const bad of [null, undefined, 42, "nope", ["a"], true]) {
      expect(recoverDiscoveryView(bad)).toEqual({ view: {}, dropped: [] });
    }
  });

  it("drops an age criterion that names both sides, which no control can show", () => {
    const { view, dropped } = recoverDiscoveryView({ age_min: 19, age_max: 25, club: "Ajax" });
    expect(view).toEqual({ club: "Ajax" });
    expect(droppedFieldLabels(dropped)).toEqual(["Age"]);
  });

  it("does not report a stored default page size as a loss", () => {
    const { view, dropped } = recoverDiscoveryView({ club: "Ajax", page_size: 12 });
    expect(view).toEqual({ club: "Ajax" });
    expect(dropped).toEqual([]);
  });

  it("rejects an over-long free-text predicate rather than truncating it", () => {
    // Truncating would silently change which players match.
    const { view, dropped } = recoverDiscoveryView({ club: "x".repeat(200), league: "Serie A" });
    expect(view).toEqual({ league: "Serie A" });
    expect(droppedFieldLabels(dropped)).toEqual(["Club"]);
  });
});

// ---------------------------------------------------------------------------
// Versioned device storage
// ---------------------------------------------------------------------------

describe("Versioned durable-collection storage", () => {
  const identity = (item: { id: string }) => item.id;
  const validate = (raw: unknown) =>
    raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string"
      ? (raw as { id: string })
      : null;

  it("writes a versioned envelope, not a bare array", () => {
    expect(writeCollection("k", [{ id: "a" }])).toBe(true);
    expect(JSON.parse(window.localStorage.getItem("k")!)).toEqual({
      version: COLLECTION_VERSION,
      items: [{ id: "a" }],
    });
  });

  it("reads nothing, and reports no recovery, when the key is absent", () => {
    expect(readCollection("k", validate, identity, 10)).toEqual({ items: [], recovered: false });
  });

  it("recovers from malformed JSON", () => {
    window.localStorage.setItem("k", "{not json");
    expect(readCollection("k", validate, identity, 10)).toEqual({ items: [], recovered: true });
  });

  it("recovers from a non-object root, including a bare array", () => {
    for (const bad of ['"a string"', "42", "[1,2,3]", "null"]) {
      window.localStorage.setItem("k", bad);
      expect(readCollection("k", validate, identity, 10)).toEqual({ items: [], recovered: true });
    }
  });

  it("recovers from an unknown envelope version without deleting anything", () => {
    window.localStorage.setItem("k", JSON.stringify({ version: 99, items: [{ id: "a" }] }));
    expect(readCollection("k", validate, identity, 10)).toEqual({ items: [], recovered: true });
    // The read is non-destructive: a newer build's data is still on disk.
    expect(JSON.parse(window.localStorage.getItem("k")!).items).toHaveLength(1);
  });

  it("drops ONE malformed item and keeps its valid siblings", () => {
    window.localStorage.setItem(
      "k",
      JSON.stringify({ version: 1, items: [{ id: "a" }, { nope: true }, null, { id: "b" }] }),
    );
    const read = readCollection("k", validate, identity, 10);
    expect(read.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(read.recovered).toBe(true);
  });

  it("collapses duplicates to the FIRST occurrence, preserving order", () => {
    window.localStorage.setItem(
      "k",
      JSON.stringify({ version: 1, items: [{ id: "a" }, { id: "b" }, { id: "a" }] }),
    );
    expect(readCollection("k", validate, identity, 10).items).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("enforces the collection limit", () => {
    window.localStorage.setItem(
      "k",
      JSON.stringify({ version: 1, items: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
    );
    const read = readCollection("k", validate, identity, 2);
    expect(read.items).toHaveLength(2);
    expect(read.recovered).toBe(true);
  });

  it("reports a write failure HONESTLY rather than swallowing it", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    try {
      expect(writeCollection("k", [{ id: "a" }])).toBe(false);
    } finally {
      setItem.mockRestore();
    }
  });

  it("survives storage that throws on access", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    try {
      expect(readCollection("k", validate, identity, 10)).toEqual({ items: [], recovered: false });
    } finally {
      getItem.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Record validation
// ---------------------------------------------------------------------------

describe("Saved-work record validation", () => {
  it("accepts a canonical UUID and rejects anything looser", () => {
    expect(validClientId(UUID_A)).toBe(UUID_A);
    for (const bad of ["", "nope", UUID_A.toUpperCase(), `${UUID_A} `, 42, null]) {
      expect(validClientId(bad)).toBeNull();
    }
    expect(validClientId(newClientId())).not.toBeNull();
  });

  it("stores a script-shaped label as inert plain text", () => {
    for (const label of ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"]) {
      expect(validLabel(label, 80)).toBe(label);
    }
  });

  it("rejects an empty, over-long or control-character label", () => {
    expect(validLabel("   ", 80)).toBeNull();
    expect(validLabel("x".repeat(81), 80)).toBeNull();
    for (const code of [0x00, 0x07, 0x0a, 0x0d, 0x1b, 0x7f, 0x2028]) {
      expect(validLabel(`Cohort${String.fromCharCode(code)}injected`, 80)).toBeNull();
    }
  });

  it("keeps a partly-stale saved view rather than discarding the record", () => {
    const item = validateSavedView({
      clientId: UUID_A,
      label: "Mixed",
      view: { club: "Ajax", role: "gone_role" },
      createdAt: 1,
      updatedAt: 2,
    });
    expect(item?.view).toEqual({ club: "Ajax" });
    expect(item?.unavailable).toEqual(["role"]);
  });

  it("rejects a saved view with no usable identity or label", () => {
    expect(validateSavedView({ label: "x", view: {} })).toBeNull();
    expect(validateSavedView({ clientId: UUID_A, label: "  ", view: {} })).toBeNull();
    expect(validateSavedView("nope")).toBeNull();
  });

  it("rejects a comparison with the same player on both sides", () => {
    expect(
      validateSavedComparison({
        clientId: UUID_A,
        label: "Same",
        playerA: { playerId: 5, name: "A" },
        playerB: { playerId: 5, name: "A" },
        roleKey: null,
      }),
    ).toBeNull();
  });

  it("rejects a comparison whose role key could not be one", () => {
    expect(
      validateSavedComparison({
        clientId: UUID_A,
        label: "Bad role",
        playerA: { playerId: 5, name: "A" },
        playerB: { playerId: 7, name: "B" },
        roleKey: "Not A Role",
      }),
    ).toBeNull();
  });

  it("never lets a stored updatedAt precede createdAt", () => {
    const item = validateSavedView({
      clientId: UUID_A,
      label: "x",
      view: {},
      createdAt: 500,
      updatedAt: 100,
    });
    expect(item?.updatedAt).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Identity and upsert
// ---------------------------------------------------------------------------

describe("Saved-work identity", () => {
  it("makes a saved view's identity its filter state, not its name", () => {
    const a = makeSavedView("One name", { club: "Ajax" });
    const b = makeSavedView("Another name", { club: "Ajax" });
    expect(savedViewIdentity(a)).toBe(savedViewIdentity(b));
  });

  it("preserves comparison side order in the identity", () => {
    const ab = makeSavedComparison("AB", { playerId: 7, name: "A" }, { playerId: 5, name: "B" }, null);
    const ba = makeSavedComparison("BA", { playerId: 5, name: "B" }, { playerId: 7, name: "A" }, null);
    expect(savedComparisonIdentity(ab)).not.toBe(savedComparisonIdentity(ba));
  });

  it("makes the selected role part of a comparison's identity", () => {
    const auto = makeSavedComparison("Auto", { playerId: 7, name: "A" }, { playerId: 5, name: "B" }, null);
    const role = makeSavedComparison(
      "Role",
      { playerId: 7, name: "A" },
      { playerId: 5, name: "B" },
      "advanced_8",
    );
    expect(savedComparisonIdentity(auto)).not.toBe(savedComparisonIdentity(role));
  });

  it("updates in place rather than duplicating, keeping the original position", () => {
    const first = makeSavedView("First", { club: "Ajax" });
    const second = makeSavedView("Second", { club: "Bayern" });
    const again = makeSavedView("Renamed", { club: "Ajax" });

    const start = [first, second];
    const result = upsertByIdentity(start, again, savedViewIdentity, 999);
    expect(result.disposition).toBe("updated");
    expect(result.items).toHaveLength(2);
    expect(result.items[0].label).toBe("Renamed");
    expect(result.items[0].clientId).toBe(first.clientId);
    expect(result.items[1].label).toBe("Second");
  });

  it("reports an identical repeat as unchanged, and writes nothing new", () => {
    const first = makeSavedView("First", { club: "Ajax" });
    const same = makeSavedView("First", { club: "Ajax" });
    const result = upsertByIdentity([first], same, savedViewIdentity);
    expect(result.disposition).toBe("unchanged");
    expect(result.items).toBe(first ? result.items : result.items);
    expect(result.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The two concrete collections
// ---------------------------------------------------------------------------

describe("Device saved-work collections", () => {
  it("uses separate keys, so one corrupt collection cannot take the other", () => {
    writeSavedViews([makeSavedView("A view", { club: "Ajax" })]);
    writeSavedComparisons([
      makeSavedComparison("A duel", { playerId: 1, name: "A" }, { playerId: 2, name: "B" }, null),
    ]);

    window.localStorage.setItem(SAVED_COMPARISONS_STORAGE_ID, "{corrupt");
    expect(readSavedViews().items).toHaveLength(1);
    expect(readSavedComparisons().items).toHaveLength(0);
    expect(SAVED_VIEWS_STORAGE_ID).not.toBe(SAVED_COMPARISONS_STORAGE_ID);
  });

  it("never writes the derived unavailable list back to storage", () => {
    // It is resolved at READ time from what is currently representable; freezing
    // today's answer would keep reporting a criterion as lost after it came back.
    const item = makeSavedView("A view", { club: "Ajax" });
    writeSavedViews([{ ...item, unavailable: ["role"] }]);
    const stored = JSON.parse(window.localStorage.getItem(SAVED_VIEWS_STORAGE_ID)!);
    expect(stored.items[0]).not.toHaveProperty("unavailable");
  });

  it("shares no key with the 8.4A favourites list", () => {
    expect(SAVED_VIEWS_STORAGE_ID).not.toBe("scoutboy.shortlist.v1");
    expect(SAVED_COMPARISONS_STORAGE_ID).not.toBe("scoutboy.shortlist.v1");
    window.localStorage.setItem("scoutboy.shortlist.v1", JSON.stringify([1, 2, 3]));
    writeSavedViews([makeSavedView("A view", { club: "Ajax" })]);
    expect(JSON.parse(window.localStorage.getItem("scoutboy.shortlist.v1")!)).toEqual([1, 2, 3]);
  });

  it("stores no analytical result for a comparison", () => {
    writeSavedComparisons([
      makeSavedComparison("Duel", { playerId: 1, name: "A" }, { playerId: 2, name: "B" }, "advanced_8"),
    ]);
    const stored = JSON.stringify(
      JSON.parse(window.localStorage.getItem(SAVED_COMPARISONS_STORAGE_ID)!),
    );
    for (const forbidden of ["score", "conclusion", "confidence", "evidence", "rolefit"]) {
      expect(stored.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("round-trips a full saved view through storage", () => {
    const view: DiscoveryView = {
      q: "Anton",
      club: "Stuttgart",
      age_max: 22,
      rolefit_min: 60,
      sort: "name_asc",
    };
    writeSavedViews([makeSavedView("Full", view)]);
    const read = readSavedViews();
    expect(read.recovered).toBe(false);
    expect(read.items[0].view).toEqual(view);
    expect(read.items[0].label).toBe("Full");
  });
});
