# Milestone 8.4B - Saved Work and Decision Continuity

## 1. The product contract

8.4A gave a scout a durable list of *players*. 8.4B gives them durable
**decisions**: the Discovery setup that produced a cohort, and the comparison
setup that weighed two players in a role.

The promise is the same short one, extended to three collections:

- **No account:** your saved work is on this device.
- **Signed in:** your saved work is in your account.

An account still adds continuity and still unlocks nothing. Discovery, player
dossiers, role leaderboards, Compare, Methodology, favouriting, saving a view and
saving a comparison all work fully without ever telling us who you are.

The complete journey this phase closes:

1. discover a cohort;
2. save the exact Discovery setup;
3. favourite candidates;
4. compare two of them in a chosen role;
5. save that comparison setup;
6. close the browser;
7. come back and continue the decision;
8. optionally sign in and find that work on another device.

### Why these two artifacts, and not the others

The roadmap listed several candidates. Two were chosen because they are the only
ones that carry a **decision** rather than a **trace**:

- A **saved Discovery view** is the answer to "which players am I considering?"
  It is small, exactly reproducible, and worthless to store approximately - the
  filter state either reproduces the cohort or it does not.
- A **saved comparison setup** is the answer to "which two, in what role?" It is
  the narrowest possible artifact for the decision a scout actually returns to.

**Recently viewed** was deferred because it is a trace, not a decision. It
accumulates without intent, it is the one collection a scout never curates, and
it converts an anonymous-first tool into one that quietly builds a behavioural
profile. Offering it would also have meant answering retention and deletion
questions this phase has no mandate to answer.

**Free-form notes** were deferred for a different reason: they are user-generated
*content*, not user-selected *state*. Content brings length limits that are
product decisions rather than technical ones, formatting expectations, revision
history, and - the moment sharing is ever considered - a materially larger
security surface. A note is a feature; a saved filter set is a bookmark.

### Explicitly excluded from 8.4B

Not implemented, deliberately: recently viewed / history tracking, free-form
notes, comments, collaboration, sharing with another user, organizations or
teams, notifications, frozen historical RoleFit scores, cloud synchronization of
the transient two-player comparison queue, mandatory accounts, security-platform
work (a complete CSP, a public rate limiter), Phase 8.5's cross-surface
terminology audit, and Phase 8.6 closeout.

### A saved comparison is a SETUP, never a result

This is load-bearing and it is enforced by the schema rather than promised in
prose. `saved_comparisons` has columns for two player references, two saved
display names and a role key. It has **no** column for a score, a conclusion, a
confidence value or an evidence summary, and the request schema has no field that
would accept one. Reopening a saved comparison runs current ScoutBoy analysis.

A scouting tool that shows a three-week-old number as though it were today's is
worse than one that shows nothing, so the storage layer is shaped to make that
impossible rather than merely discouraged.

## 2. The canonical Discovery view

Six things need to agree about what a filter/sort state *means*:

- the live filter rail,
- the Discovery URL it writes,
- a saved view's identity ("have I already saved this cohort?"),
- reopening a saved view,
- device storage,
- what the API will accept.

Before this phase they each derived it separately, and `SearchExperience` carried
its own default-omission rules that nothing else could see. `lib/filters/canonical.ts`
now owns the rules as pure functions and all six call them.

### What a view carries

| Field | Notes |
| --- | --- |
| `q` | Free-text search needle |
| `position_group` | Validated against the rail's own option list |
| `role` | A configured role key |
| `league`, `club`, `nationality` | Free-text predicates |
| `playstyle` | A playstyle key |
| `age_min` **or** `age_max` | Exactly one side, always on a career-stage stop |
| `min_minutes` | 0-10,000 |
| `rolefit_min`, `rolefit_max` | 0-99, coherent pair |
| `value_min`, `value_max` | Absolute EUR, coherent pair |
| `sort` | Omitted at the default |
| `page_size` | Omitted at the default |

### What a view deliberately does NOT carry

- **`page`.** Opening a saved view always starts on page 1. A saved page number
  is a promise about a result set that reorders whenever the data does.
- **`scope` / `universe`.** Analysis Scope was retired from Discovery in Phase
  8.1A. A legacy scope-bearing URL still loads and still means what it said;
  persisting it would put the retired control back by the side door.
- **`age_band`.** The retired legacy parameter is normalized into a one-sided
  `age_min`/`age_max` on the way in and never stored in its own right.
- **Unknown parameters, malformed values, and transient input drafts.** A
  mid-typing `"12."` in the asking-price field is held by the control's own text
  draft and is never part of a view.

`page_size` **is** carried, and that is a judgement call worth stating: the rail
exposes no page-size control today, so by the strictest reading it is not
user-controlled. It is nonetheless part of the representable URL contract - a
hard-loaded `?page_size=24` is parsed, honoured and re-serialized - so omitting it
would mean a saved view silently reopening a different-sized ledger than the one
it was saved from. It is bounded 1-100 by the same schema the public endpoint
uses, so carrying it costs nothing.

### Identity

`discoveryViewIdentity()` produces a sorted, URL-encoded `key=value` string.
Two views that canonicalize to the same representable state produce the same
identity, which is what makes "saving this again must not create a duplicate"
decidable in the browser without a round trip.

It is deliberately **not** a hash. The browser needs no cryptography for this,
`crypto.subtle` is async and would infect every call site, and a plain string is
inspectable when something goes wrong. The API computes its own SHA-256 for its
unique index, and the two never have to agree, because the browser recomputes its
identity from the filters the API *returns* rather than comparing digests with it.

### Unicode

Free-text predicates are NFC-normalized on both sides. "Köln" typed on macOS
arrives decomposed and pasted from elsewhere arrives composed; the two are
visually identical, compare unequal, and would otherwise produce two saved views a
scout cannot tell apart. The API applies the same normalization in
`DiscoveryViewFilters`, so one club name has exactly one stored form and one
identity.

## 3. The Compare URL contract

Before 8.4B, `/compare` hydrated `a` and `b` from the URL **once** into local
state and then let the selectors drift: changing a player never updated the
address bar, `role` was never in the URL at all, and back/forward restored
neither. A comparison was therefore unshareable, unbookmarkable, and impossible
to store as a setup - which is exactly what this phase has to store.

The page now derives all three selectors directly from `useSearchParams`. There
is no second copy to fall out of step.

| Rule | Behaviour |
| --- | --- |
| Canonical parameters | `a`, `b`, and an explicit `role` |
| Automatic Role | Omits `role` entirely. No `auto` sentinel |
| Selector change | Writes the URL with `pushState` |
| Malformed id | Removed; the selector is left unset and a notice says so |
| Unknown role | Same, and the comparison opens with Automatic Role |
| Hard load, reload, back/forward | Restore all three |
| Loading a saved setup | Opens that exact URL |

`push` rather than `replace`, deliberately: choosing a different player is a step
in a decision and earns a history entry a scout can walk back. A Discovery filter
keystroke does not, which is why that surface still replaces.

The comparison **queue** is untouched. It stays device-local in
`scoutboy.compareQueue.v1`, the floating "Open Comparison" tray is still
suppressed by route on `/compare`, leaving the route brings it straight back with
the same two players, and the tray still says "device local". A saved comparison
setup and the transient queue are different things, and only the former syncs.

## 4. Saved Work hub and navigation

One surface at `/saved`, with three URL-addressable sections:

| Section | URL | Contents |
| --- | --- | --- |
| Favorites (default) | `/saved` | The 8.4A My Favorites ledger, unchanged |
| Views | `/saved?section=views` | Saved Discovery setups |
| Comparisons | `/saved?section=comparisons` | Saved comparison setups |

- **One section renders at a time**, so the page cannot become one long scroll of
  every collection at once.
- Section state is in the URL, so it survives reload and back/forward, and
  switching sections pushes a history entry.
- A malformed `?section=` falls back to Favorites rather than 404ing or rendering
  an empty surface.
- Counts appear only when known. `null` renders as **no number**, never as zero -
  a returning account holder must not read "Views 0" for the frame before their
  real collection arrives.

The three controls are buttons in a labelled `<nav>`, with `aria-current` naming
the open one. A `tablist` was considered and rejected: these are URL-addressable
sections that create history entries, so they behave like navigation rather than
like tabs, and announcing them as tabs would promise arrow-key semantics that
would then fight the browser's own history.

### Navigation

The `My Favorites` slot became **one** `Saved` entry. No second top-level item was
added: favourites, saved views and saved comparisons are three kinds of saved
work, and giving each its own entry would spend three of five navigation slots on
collections. The header counter still reports My Favorites specifically and by
name, because that is the number a scout watches while they work.

### `/shortlist` is preserved, and renders rather than redirects

Existing bookmarks and shared links must not reach a 404. The route renders the
same `FavoritesPanel` component the hub does - one implementation, so the two
surfaces cannot drift - with the page title, heading and copy it has always had,
plus a quiet pointer to `/saved`.

Rendering rather than redirecting was chosen because a redirect costs a returning
scout a navigation and a flash of the wrong page for no benefit, and because it
keeps every existing E2E assertion about that surface meaningful instead of
rewriting a dozen of them to follow a redirect.

### Where the two save actions live

**Save View** is in the Discovery page heading's existing control slot.

- Not in the **filter rail**: it is 248px wide and already intentionally dense,
  and adding collection management there would push the controls a scout came for
  below the fold.
- Not in a **new bar above the ledger**, which is the more obvious "results-level"
  spot: the ledger's own count header is deliberately *inside* its bordered
  container precisely so the rail and the ledger start at the same y on desktop
  without a faked spacer. A row above the ledger would reintroduce exactly the
  misalignment that arrangement exists to avoid.
- The heading slot is always present, so a cohort with **no matches** - the case
  where coming back later matters most - can still be saved.

**Save Comparison** sits with the selection controls it describes, inside the same
card, separated by a hairline rule. Not in a fourth floating box: the bottom rail
already carries the compare tray and the account suggestion.

Both open a compact anchored `NamePanel`. It is **non-modal** on purpose - a
naming prompt does not need to take the page hostage, and a real modal brings a
focus trap, an inert background and a scroll lock, three mechanisms that each have
their own failure modes, in exchange for nothing this interaction needs.
`role="dialog"` without `aria-modal` is what a non-modal dialog is.

### Geometry

Every new box uses the established system: zero border radius, 90-degree corners,
existing border weights and spacing tokens, no pills, no floating rounded cards,
no ornamental shadows. No existing surface was visually redesigned. The
sharp-corner source scan and a rendered-DOM audit over all three sections enforce
it.

## 5. Guest persistence

Two versioned envelopes, under separate keys:

```json
{ "version": 1, "items": [] }
```

| Key | Holds |
| --- | --- |
| `scoutboy.savedViews.v1` | Saved Discovery views |
| `scoutboy.savedComparisons.v1` | Saved comparison setups |

Separate keys deliberately: the two have different shapes, different failure modes
and different sizes, and one corrupt comparison must not be able to take a scout's
saved views with it. Neither shares a key with `scoutboy.shortlist.v1`, so nothing
here can damage the 8.4A favourites list - which keeps its existing bare-array
format, because a versioned envelope buys nothing for a list of integers and
migrating real user data to add one would be pure risk.

### Stored record shapes

```jsonc
// scoutboy.savedViews.v1
{ "clientId": "<uuid>", "label": "<plain text>", "view": { /* canonical view */ },
  "createdAt": 1735689600000, "updatedAt": 1735689600000 }

// scoutboy.savedComparisons.v1
{ "clientId": "<uuid>", "label": "<plain text>",
  "playerA": { "playerId": 7, "name": "..." },
  "playerB": { "playerId": 5, "name": "..." },
  "roleKey": null,
  "createdAt": 1735689600000, "updatedAt": 1735689600000 }
```

A player's **name** is stored because it is the only way to explain an unavailable
participant honestly after that player is gone - a saved setup that reads "player
4118 is no longer available" tells a scout nothing. No API response, no score, no
conclusion, no confidence value and nothing identifying a person is stored.

The derived `unavailable` list is **not** written back: it is resolved at read time
from what is currently representable, so persisting it would freeze today's answer
into tomorrow's storage and keep reporting a criterion as lost after the
configuration that dropped it came back.

### Recovery rules, and why each exists

| Input | Behaviour |
| --- | --- |
| Key absent | Empty collection, no recovery reported |
| Unparseable JSON | Empty collection, recovery reported |
| Non-object root (string, number, bare array, `null`) | Empty, recovery reported |
| Unknown `version` | Empty, recovery reported, and **nothing is deleted** |
| `items` not an array | Empty, recovery reported |
| One malformed item | Dropped; valid siblings kept |
| Duplicate identity | Collapses to the **first** occurrence |
| Over the collection limit (200) | Excess dropped, recovery reported |
| Storage throws on access | Empty collection; never throws upward |
| Write throws (quota, private mode) | **Returns `false`** |

An unknown version reads as empty rather than being guessed at, because the most
likely writer is a *newer* build in another tab. The read is non-destructive, so
that build's data stays on disk.

**A failed write is reported, never swallowed.** `writeCollection` returns a
boolean, the state machine only advances the visible collection when the write
actually landed, and the naming panel stays open showing "There was no room to
save that on this device" with the typed name intact. Nothing in this layer can
claim something was saved when it was not.

## 6. Optional-account persistence

### Database model

Migration `0008_saved_work` (revises `0007_optional_accounts`). Additive only: no
existing table, column, index or constraint is touched, so an anonymous deployment
runs against the post-migration schema exactly as before and an existing 8.4A
deployment keeps every favourite it holds.

#### `saved_discovery_views`

One **typed column per Discovery parameter**, not a JSON blob. That is what makes
"no arbitrary URL or opaque payload is stored" a property of the schema rather
than a promise made above it - there is nowhere to put one.

| Column | Type |
| --- | --- |
| `id` | integer PK, also the ordering tie-break |
| `user_id` | FK `app_users.id` **ON DELETE CASCADE**, indexed |
| `client_id` | varchar(36), a client-generated UUID |
| `fingerprint` | varchar(64), server-computed SHA-256 |
| `label` | varchar(80) |
| `q`, `league`, `club`, `nationality` | varchar(120), nullable |
| `position_group`, `role`, `playstyle`, `sort` | varchar(64), nullable |
| `age_min`, `age_max`, `min_minutes`, `rolefit_min`, `rolefit_max`, `page_size` | integer, nullable |
| `value_min`, `value_max` | **bigint**, nullable |
| `created_at` / `updated_at` | timestamptz |

`value_*` is `BigInteger` because a hand-crafted absolute-EUR bound can exceed a
32-bit integer long before the request schema's own ceiling rejects it, and an
overflow at the storage layer is a worse failure than a 422.

#### `saved_comparisons`

| Column | Type |
| --- | --- |
| `id` | integer PK |
| `user_id` | FK `app_users.id` **ON DELETE CASCADE**, indexed |
| `client_id` | varchar(36) |
| `fingerprint` | varchar(64) |
| `label` | varchar(80) |
| `player_a_id`, `player_b_id` | FK `players.id` **ON DELETE SET NULL**, nullable, indexed |
| `player_a_label`, `player_b_label` | varchar(160), NOT NULL |
| `role_key` | varchar(64), nullable - NULL **is** Automatic Role |
| `created_at` / `updated_at` | timestamptz |

**The foreign-key actions differ on purpose.** `CASCADE` from the account, because
deleting an account means deleting its saved work. `SET NULL` from a player,
because cascading would silently destroy a scout's saved comparison as a side
effect of a data refresh that happened to drop one participant, while a dangling
id would let the interface fabricate a player that no longer exists. Nulling the
reference while keeping the saved label lets the row stay visible, renameable and
removable, and lets the interface name the unavailable side honestly. There is no
dangling reference either way.

#### Two unique constraints per table

- `uq_*_fingerprint` on `(user_id, fingerprint)` is the **logical** identity, so
  saving the same configuration twice updates the existing row.
- `uq_*_client_id` on `(user_id, client_id)` is the **retry** identity, so a
  create whose response was lost is retried onto the same row.

Both are scoped to `user_id`, so one account's id can never address another's row.

The fingerprint is a fixed-width digest rather than the canonical query string
itself, because a percent-encoded club name would push a raw string past
PostgreSQL's btree key-size limit. It is computed **server-side** from the
validated columns, so two clients cannot disagree about what a view means and no
client can split one logical view into two by sending its own digest.

#### Ordering

`(created_at, id)`, never `created_at` alone, for exactly the reason
`user_favorites` documents: a merge inserts several rows inside one transaction
and the timestamp default can hand them all the same value, so the autoincrement
key is the total tie-break. `ix_saved_*_user_order` serves the one query every
endpoint ends with.

### API contract

| Method | Path | Behaviour | Creates an account row? |
| --- | --- | --- | --- |
| `GET` | `/api/me/saved-views` | Canonical ordered list. Never writes | No |
| `POST` | `/api/me/saved-views` | Idempotent create/upsert | Yes |
| `PATCH` | `/api/me/saved-views/{client_id}` | Rename. 404 if absent | No |
| `DELETE` | `/api/me/saved-views/{client_id}` | Idempotent remove. Never 404s | No |
| `POST` | `/api/me/saved-views/merge` | Union a device collection | Only if it stores something |

The same six for `/api/me/saved-comparisons`.

8.4A established "reads do not write". 8.4B extends it to **no-op mutations**: an
idempotent delete stores nothing, a rename of a non-existent item stores nothing,
and a merge with no storable item stores nothing, so none of the three
materializes an account. The merge depends on the raw verified identity and calls
`resolve_app_user` only once it knows at least one item will actually be inserted.

Status codes: **401** as 8.4A; **404** for a rename of an item this account does
not hold; **409** for an unresolvable merge conflict; **422** for an
unrepresentable filter, an unknown key, a malformed `client_id`, an oversized body
or a full collection; **503** when no identity provider is configured.

### Upsert resolution order

1. **By canonical fingerprint.** Two views that canonicalize to the same state ARE
   the same view, so saving the same configuration again renames the existing one -
   taking the label the scout just typed, because naming it is what they asked for.
   The account's own `client_id` is **kept**, not replaced by the caller's: other
   devices address the row by it, and the client adopts the canonical list this
   response carries.
2. **By client id.** A create whose response was lost is retried onto the same row.
   This is also the path that replaces a saved view's filters in place.
3. **Insert.** A uniqueness race means a concurrent request won; the loser re-reads
   the winner's row rather than surfacing a 500.

### Validation

Structure, bounds and canonical form are enforced by Pydantic; **membership** is
checked in the service layer against live configuration, exactly as `/api/players`
already does for `role`, `sort` and `position_group`.

`DiscoveryViewFilters` sets `extra: "forbid"`, so a stale or hand-crafted body
carrying `scope`, `universe`, `age_band` or `page` is a 422 rather than a silently
ignored extra. It additionally rejects any state the rail could not have produced:
both age sides set, an off-stop age value, or an incoherent inclusive pair.

Labels are user-authored **plain text**: trimmed, bounded to 80 characters, and
rejected if they contain C0, DEL, C1 or Unicode line/paragraph separators. Nothing
is escaped or stripped. `<script>alert(1)</script>` is a valid 24-character label
and is stored verbatim, because React renders it as text and it is never
interpolated into markup, a URL or a SQL string. Sanitising it here would corrupt
legitimate labels ("Wingers < EUR 5M") while defending nothing that is not already
defended where it is rendered.

`client_id` is a canonical lower-case hyphenated UUID and nothing looser. The
pattern is declared **once** (`CLIENT_ID_PATTERN`) and applied to both the request
body and the URL path. That single declaration is a correction: the first
implementation constrained only the body, because combining
`Annotated[str, Field(...)]` with a `Path()` default silently drops the `Annotated`
metadata - and the path parameter accepted `1 OR 1=1` until a test caught it.

### Limits

`MAX_MERGE_ITEMS = 200` per artifact type, and `MAX_COLLECTION_ITEMS = 200` per
account per type. Exceeding either is a 422 rather than a silent truncation, for
the same reason the favourites merge refuses to drop the tail of a list. A merge
that would push the collection past the ceiling is refused **whole**, so the
device copy stays intact and retryable.

## 7. Guest-to-account merge

Server-side ordering rules, in order:

1. Whatever the account already holds keeps its established position **and its
   existing label**. A collection curated on one device is neither reshuffled nor
   silently renamed by signing in on another.
2. Device items the account already holds by canonical identity are reported as
   `already_present` and are not re-inserted.
3. Genuinely new device items are appended in device order.
4. Items that fail validation are reported in `rejected` and never stored, so a
   stale device artifact cannot write an unrepresentable filter into an account.

Duplicates inside one device payload collapse to their **first** occurrence and the
later one is reported as rejected, so every offered `client_id` is accounted for.
`added`, `already_present` and `rejected` are disjoint and their union is every
distinct requested id.

Each attempt is one transaction, and a rolled-back attempt is not the end of the
story: the loop re-reads canonical state, recomputes what is genuinely still
missing, and finishes the remainder, bounded by `MERGE_MAX_ATTEMPTS` (4). Only a
uniqueness race is retried - a NOT NULL or foreign-key breach propagates. If any
valid item is still absent after the bound, the request answers **409** rather
than a 200 whose disposition lists quietly omit it.

### Client-side merge behaviour

1. Read the valid device collection **at that moment** (not from a stale closure).
2. `POST .../merge`.
3. Keep the device data untouched until the server confirms.
4. Adopt the server's canonical list.
5. **Only then** clear the device collection, so private account data is never
   left readable by the next anonymous visitor to this browser.
6. On failure: retain it, **keep showing it**, enter `account-unconfirmed`, and
   expose a non-destructive "Try Again".

**Each collection is confirmed independently.** If saved views merge and saved
comparisons do not, only the comparisons stay device-local and unconfirmed. That
is why `useDurableCollection` is instantiated twice rather than once over a
combined payload.

**While unconfirmed, the device is the system of record.** Saving, renaming and
removing stay fully available and stay entirely device-local: they update the
visible collection and browser storage on every interaction, and issue no
individual account request. Retry re-reads storage and merges the collection **as
it stands at that moment**, not the snapshot the session began with.

### Concurrency

| Property | Mechanism |
| --- | --- |
| Per-item writes are serialized | One promise chain per `client_id` |
| The latest intent wins | Each intent carries a monotonic revision; a settling request retires only the intent it started for |
| An older completion cannot retire a newer intent | `settle()` compares revisions and reconciles instead |
| Rollback changes only the affected artifact | Rollback operates on the CURRENT collection, never a whole-list snapshot |
| Rollback targets the newest confirmed state | `intent.baseline` is re-based onto the canonical item every time a canonical collection is adopted |
| Unrelated optimistic edits survive | Same |
| Stale account/session responses cannot land | Session generation, checked at every async hop |
| Server uniqueness races converge | The database decides; the loser re-reads the winner |
| A partial merge is never reported as success | 409, and the device copy is not cleared |

Intent is recorded **synchronously in the event handler**, never inside a state
updater. Recording it in an updater made it depend on React's render timing: the
chain's first microtask could run before the updater and find no intent at all, so
the request was never sent and the item stayed pending forever. This is the same
correction 8.4A records for favourites, and it applies for the same reason.

### What "success" means, and when a caller learns it

The two modes mean different things by success, and `WriteResult` distinguishes
them:

| Mode | `ok: true` means | Known when |
| --- | --- | --- |
| Guest | the DEVICE write completed | synchronously - `localStorage` accepted the value or threw |
| Account | the SERVER confirmed the mutation | when the request reaches a terminal state |

**An optimistic render is never itself a successful `WriteResult`.** The
collection updates immediately, because that is the feedback a scout needs; the
promise a caller awaits does not settle until the account has actually taken the
change. Until then the naming panel stays open, keeps the typed value, stays busy,
and announces nothing, and the collection reports `account-saving`.

This is a correction. `save()` and `rename()` previously resolved `ok: true` the
moment a request was QUEUED, so a panel closed, restored focus and announced
"Saved" while the server had confirmed nothing - and a later failure then
contradicted an announcement the scout had already read. Each intent now carries
the caller's `resolve`, and `syncItem` settles it on every terminal path,
including the ones that used to return early.

A third outcome exists because two are not enough:

| Disposition | Meaning | Caller behaviour |
| --- | --- | --- |
| `created` / `updated` / `removed` | confirmed by the server | close, restore focus, announce |
| `unchanged` | nothing to do; no request was made | close, announce "already saved" |
| `failed` | terminal failure | stay open, keep the typed value, show the error, announce nothing |
| `superseded` | a newer intent replaced this one, or the account/generation moved on | stop being busy, stay silent in both directions |

`superseded` is what stops an obsolete caller announcing anything. It is delivered
when a newer intent replaces a pending one, when a settling request finds its
intent has been overtaken, and when the account changes - the account-change
effect releases every outstanding intent before it discards the write book, so no
naming panel is ever left busy on a promise nothing can settle.

### Rollback

A failed write restores exactly one item to **the newest state the server has
confirmed** - not to the state that write was queued against.

| `intent.baseline` | Rollback does |
| --- | --- |
| the account's canonical item | puts that item back: in place if it is still on screen, or at the index a failed removal took it from (clamped, never duplicated) |
| `null` - the account does not hold it | removes the item; nothing is fabricated |

`WriteBook.canonical` holds the COMPLETE server-confirmed item per `client_id`
for this generation only, refreshed by `adoptCanonical` from every canonical
response the account adopts - the initial load/merge and every per-item write.
Adopting also **re-bases** `intent.baseline` for any intent still outstanding on
those items. A fresh book starts empty and un-adopted, so a rollback can never
restore something belonging to a previous account or a previous sign-in.

Two corrections are recorded here, both from overlapping writes.

**A failed rename used to leave the typed label on screen**, showing account state
the server had never held until the next reload. The baseline is carried on the
intent because by failure time the visible label IS the optimistic one - there is
nothing left on screen to roll back to.

**A captured baseline was still not enough once writes overlapped.** The baseline
was fixed when the newer intent was created, which is necessarily *before* the
older write's response updated the canonical state:

| Step | Server | Screen | Old baseline for intent 2 |
| --- | --- | --- | --- |
| confirmed | `A` | `A` | - |
| rename `A → B` queued | `A` | `B` | - |
| rename `B → C` queued before `B` settles | `A` | `C` | `A` |
| `B` confirmed | `B` | `C` | `A` (stale) |
| `C` refused | `B` | **`A`** | - |

The client rolled back past a change the account had accepted, and the two stayed
visibly out of step. Re-basing on adoption makes the last row settle on `B`: the
older caller resolves `superseded` and announces nothing, the newer resolves
`failed` and reports it once, pending clears, and the label matches the server.

The same staleness applied to a removal queued behind an in-flight rename: it
captured the optimistic item, so a failed removal could restore a label that had
only ever existed on screen. Both now read the same canonical baseline.

An item the canonical collection no longer contains re-bases to `null` - so a
rename that fails after a concurrent deletion elsewhere removes the item rather
than reviving it under a label nobody holds.

Rollback is **never** a whole-collection snapshot: it changes exactly one item on
the CURRENT collection, so an unrelated create, rename or removal made while the
request was in flight survives it, and canonical server ordering stays
authoritative.

### Session generations

`useAccountGeneration` produces `${accountKey}#e${epoch}#a${attempt}`, where
`epoch` is a monotonic counter that advances on every authentication lifecycle
transition and is never reset - so a generation value is never reused for the life
of the page.

It is **extracted** from the 8.4A favourites implementation rather than shared with
it. The favourites provider deliberately keeps its own copy: it is correct, it is
covered by a dozen named invariants, and rewiring a working synchronization state
machine to consume a new abstraction is how a regression gets introduced into the
one collection that already works. The two generations do not need to be the same
value - each only has to be unique within its own state machine.

### Shared primitives, not a shared framework

| Extracted | Not extracted |
| --- | --- |
| Versioned storage envelope + validators (`durable-collection.ts`) | The favourites state machine |
| The collection state machine, parameterized by adapter (`useDurableCollection`) | The favourites storage format |
| Canonical ordering, idempotent upsert/remove, convergent merge (`saved_work_service`) | `favorites_service` |
| Session generation (`useAccountGeneration`) | The favourites provider's own copy |

## 8. Stale and unavailable recovery

### Saved Discovery views

A stored view whose filters are partly unrepresentable is **still a valid item**.
`recoverDiscoveryView` validates field by field and drops only the invalid parts,
so a scout whose playstyle was retired gets their league, age and club back rather
than losing the saved view entirely. The row shows a concise notice naming exactly
which criteria are unavailable, `Open` reopens everything still valid, and rename
and remove stay enabled. Nothing invalid is ever forwarded to the API, and there
is no URL rewrite loop because the recovered view is already canonical.

Account items go through the **same** recovery path (`savedViewFromWire`). An
account view saved by an older build against a since-retired role must degrade
identically; skipping it there would make "part of this view is no longer
available" a guest-only behaviour.

### Saved comparisons

| Situation | Behaviour |
| --- | --- |
| A player is gone | Item stays visible; the missing side keeps its saved name and loses its id; `Open` is **disabled, not hidden**, and its accessible name says why; rename and remove stay available |
| Only the role is gone | Item stays fully openable **with Automatic Role**, and the fallback is explained before it happens |
| Both players gone | As above; the item is never silently deleted |

Availability is decided by whether the player **resolves right now**, not by
whether the foreign-key column happens to be null. That distinction is not
academic: `ON DELETE SET NULL` is the PostgreSQL-side guarantee, but SQLite does
not enforce foreign keys under this project's configuration - the same limitation
`favorites_service` compensates for by validating player existence explicitly on
every write. Reading the column alone reported a deleted player as still available
on SQLite and unavailable on PostgreSQL: one saved setup, two answers, depending
on the engine. `comparison_records` resolves the whole page in one `IN` query.

Both players must exist when a setup is **first saved**, so a stale device artifact
cannot manufacture the unavailable state. A player removed **afterwards** is a
different thing entirely, and the saved setup survives it.

Guest Favorites' stale-id behaviour and account Favorites' foreign-key behaviour
are unchanged.

## 9. The account suggestion

Generalized from "after a new favourite" to "after a guest's first durable save of
this session", where a durable save is any of:

- favouriting a player,
- saving a Discovery view,
- saving a comparison setup.

The two save signals are **summed** and the once-per-session latch is shared, so a
scout who does all three in one session is asked once - and is asked after
whichever came first. Three separate callouts would have meant three asks.

Unchanged: optional, non-modal, dismissible, `sessionStorage`-latched per session,
30-day "Not now" window at `scoutboy.accountSuggestion.v1`, never steals focus,
Escape and "Not now" are the same decision, announced once via a polite
`role="status"`, absent for signed-in users and in auth-free builds, and stacked
**above** the compare tray in the shared bottom rail so it can never obscure it.

It is shown only after **confirmed local persistence**, which is why a failed write
cannot raise it: the signal increments inside the branch that already verified the
write landed.

It no longer excludes `/compare`. In 8.4A the comparison queue was not
account-synchronized, so offering an account from that surface would have promised
something untrue; a saved comparison **setup** genuinely does sync, so the offer is
honest there now. The transient queue still does not sync, and the tray still says
so.

New copy: *"Saved on this device. Create an account to keep saved work across
devices."*

## 10. Privacy and security

### The boundary

- Strict owner scoping on every query: `user_id` is in the WHERE clause itself,
  never filtered afterwards in Python.
- Every private endpoint depends on a verified-identity dependency.
- No IDOR-capable owner parameter exists. There is no `user_id` path parameter, no
  owner field in any body, and no header outside `Authorization` that names a
  person. `client_id` addresses a row **within** the caller's own account, so a
  well-formed id belonging to somebody else resolves to nothing.
- A rename of another account's item returns **404**, indistinguishable from "does
  not exist at all", so the response is not an existence oracle.
- Every service function takes an `AppUser` object, never an id. A test asserts
  the signatures.
- Bounded request bodies (200 items) and bounded collections (200 per type).
- Bounded, trimmed plain-text labels; control characters rejected.
- React text rendering only. No `dangerouslySetInnerHTML` anywhere in the phase.
- No arbitrary redirect or stored URL: a saved view is typed columns, and a saved
  comparison is two integers plus a role key.
- No `javascript:` or `data:` URL is acceptable anywhere, because no field accepts
  a URL.
- Strict filter and role allowlists, checked against live configuration.
- Parameterized SQLAlchemy throughout; no string-built SQL.
- No secrets in the browser bundle, in logs, or in this document.
- No account data is ever written to `localStorage`.
- Private query caches are partitioned by account key and removed on identity
  change.
- No account row is created by a read-only or no-op request.

### Threat considerations

| Concern | Position |
| --- | --- |
| Stored XSS via a label | Labels are stored verbatim and rendered as React text. Covered by explicit tests using `<img src=x onerror=...>` and `<script>alert(1)</script>` at the API, unit and E2E layers |
| Open redirect via a saved view | Unrepresentable: a view is typed columns, not a URL |
| IDOR via `client_id` | Every query is owner-scoped; a foreign id resolves to nothing |
| Path traversal / injection via `client_id` | Canonical-UUID pattern on body and path; parameterized queries |
| Unbounded storage growth | 200-item ceilings on both the merge body and the collection |
| Cross-account cache bleed | Account-key-stamped state, filtered during render; `["me", ...]` cache dropped on identity change |
| Enumeration via 404 vs 403 | One 404 shape for "not yours" and "does not exist" |
| Integer overflow on asking bounds | `BigInteger` storage plus a schema ceiling |

**This is not the Milestone 9 audit.** Still outstanding: rate limiting on the
private endpoints, audit logging, a formal threat model, security headers and CSP,
penetration testing, session-revocation propagation timing, and a data-retention
and deletion policy.

## 11. Migration behaviour

- Clean upgrade from `0007_optional_accounts`.
- Clean upgrade from an empty database through head.
- `downgrade` removes **only** the two 8.4B tables. `app_users` and
  `user_favorites` belong to 0007 and are left exactly as they are, so downgrading
  returns a deployment to working 8.4A optional accounts rather than to no
  accounts at all.
- Idempotent, following the repository convention: every `create_table` is guarded
  by an inspector check.
- Portable DDL. `sa.DateTime(timezone=True)` becomes TIMESTAMP WITH TIME ZONE on
  PostgreSQL and a TEXT-backed datetime on SQLite. Tables are created, never
  altered, so no batch/`render_as_batch` rewrite is involved on SQLite.
- A parity test builds a database with `alembic upgrade head` **in a subprocess
  with its own `DATABASE_URL`** and asserts that its columns, nullability and
  unique constraints match `Base.metadata`. The subprocess matters: `env.py`
  resolves the URL from memoized settings, so an in-process `command.upgrade`
  would migrate the pytest database instead.

## 12. Operational configuration

**No new configuration.** 8.4B introduces no environment variable, no feature flag
and no new secret. It inherits the 8.4A auth configuration exactly:
`SCOUTBOY_AUTH_ENABLED`, `SCOUTBOY_CLERK_ISSUER`,
`SCOUTBOY_CLERK_AUTHORIZED_PARTIES` and the optional JWKS/leeway settings on the
backend; `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
`NEXT_PUBLIC_SCOUTBOY_AUTH_ENABLED` on the frontend.

With no identity provider configured, the six new routes answer 503 exactly as the
favourites routes do, and the browser issues none of them.

Local development is unchanged: `make seed && make dev` gives the full anonymous
product including saved views and saved comparisons.

## 13. Known limitations

- **No live-tenant verification was performed.** No Clerk credentials were
  available for this phase either. Every account behaviour is covered by
  deterministic offline tests; none has been exercised against a real Clerk
  instance. The 8.4A section 12 checklist applies unchanged, with saved views and
  saved comparisons added to each step.
- A device saved comparison reports both participants as available, because a
  device cannot know otherwise without a request per participant on every render.
  The account path reports the truth the server knows. This matches how guest
  Favorites already treats a stale id.
- Saved collections are not paginated. A 200-item collection is fetched whole.
- There is no offline write queue, as in 8.4A.
- A saved view's `page_size` is stored but has no visible control to change it.
- The 200-item ceilings are global rather than per-plan; there is no plan concept.
- `account-desynced` remains per-session state: a reload while desynced
  re-attempts the load rather than restoring the previous error message.

## 14. Where the code lives

| Concern | File |
| --- | --- |
| Canonical Discovery view (parse, serialize, identity, recovery) | `apps/web/src/lib/filters/canonical.ts` |
| Versioned storage envelope and shared validators | `apps/web/src/lib/storage/durable-collection.ts` |
| The two device collections | `apps/web/src/lib/storage/saved-work.ts` |
| Private saved-work API client | `apps/web/src/lib/api/saved-work.ts` |
| Session generation | `apps/web/src/lib/auth/generation.ts` |
| Guest/account state machine for both collections | `apps/web/src/lib/state/saved-work.tsx` |
| Naming panel and confirm-remove control | `apps/web/src/components/saved/NamePanel.tsx` |
| Save View / Save Comparison actions | `apps/web/src/components/saved/SaveViewControl.tsx`, `SaveComparisonControl.tsx` |
| The three hub sections | `apps/web/src/components/saved/FavoritesPanel.tsx`, `ViewsPanel.tsx`, `ComparisonsPanel.tsx` |
| The hub | `apps/web/src/app/saved/page.tsx` |
| Legacy favourites route | `apps/web/src/app/shortlist/page.tsx` |
| Compare URL contract | `apps/web/src/app/compare/page.tsx` |
| ORM models | `apps/api/app/models/orm/saved_work.py` |
| Request/response schemas | `apps/api/app/models/schemas/saved_work.py` |
| Identity, validation, merge, CRUD | `apps/api/app/services/saved_work_service.py` |
| Routes | `apps/api/app/api/routes/me.py` |
| Migration | `db/migrations/versions/0008_saved_work.py` |
| Backend tests | `apps/api/app/tests/test_saved_work.py` |
| Frontend unit tests | `apps/web/src/tests/saved-work-storage.test.ts`, `saved-work.test.tsx` |
| E2E | `tests/e2e/saved-work.spec.ts` |
| Shared empty / error states | `apps/web/src/components/common/index.tsx` |
| Entrance motion and its contrast constraint | `apps/web/src/app/globals.css` (`.pane-enter`) |
| First-frame contrast E2E | `tests/e2e/state-contrast.spec.ts` |

## 15. Visual verification guidance

Run the anonymous stack (`make seed && make dev`, or the production build) and
check:

1. **Discovery** - narrow with two or three filters. `Save View` sits in the page
   heading's right-hand slot and is disabled until at least one filter is active.
2. Save it. The button becomes `Saved View`; pressing it again offers a rename
   rather than a second copy.
3. **`/saved`** - three equal-weight square controls, Favorites open by default,
   counts beside each. Switching sections changes the URL and the browser's back
   button returns to the previous section.
4. **Views** - each row shows its criteria in the rail's own words, with `Open`,
   `Rename` and `Remove`. `Remove` requires a second, explicit `Confirm`.
5. **Open** a saved view: the Discovery URL is exactly the saved cohort, and the
   ledger reports page 1.
6. **Compare** - choose two players and a role; the address bar tracks all three.
   `Save Comparison` sits under the selectors, inside the same card.
7. Save it, then open it from `/saved?section=comparisons`.
8. **Geometry** - every new box is 90 degrees. No pill, no rounded card, no shadow.
9. **Reflow** - 1440 / 1280 / 1024 / 768 / 640 / 390 / 320 with no horizontal
   scrollbar on any section.
10. **Keyboard** - Tab to `Save View`, Enter, type a name, Enter. Escape from an
    open panel returns focus to the control that opened it.

Signed-in verification requires Clerk credentials; see §13.

### Empty and error states appear at full contrast

`EmptyState` and `ErrorState` carry **no entrance animation**. `pane-enter` fades
from `opacity: 0`, and a browser composites that opacity into the text colour, so
mid-fade the ink really is a blend with the paper behind it:

| Text | Rests at | Falls below 4.5:1 at |
| --- | --- | --- |
| `--ink-soft` on `--panel` (empty state) | 5.39:1 | ~93% opacity |
| `--red` on `#f4e8e3` (error state) | ~6.2:1 | ~83% opacity |

Every frame of a 180ms fade was therefore a frame that text did not meet WCAG 2.2
SC 1.4.3, and an axe scan landing in that window reported a genuine `color-contrast`
failure on `.pane-enter > span` - "Pick two players to compare." Raising the
keyframe's floor is not an alternative: with 0.89:1 of headroom, every compliant
floor is visually indistinguishable from no fade.

Only the entrance changed. The resting colours, type, spacing, alignment, borders
and square geometry are byte-identical, and both states now behave under normal
motion exactly as they always did under `prefers-reduced-motion: reduce`. The
populated results pane keeps `pane-enter`: its content is `--ink` at ~15:1, it
replaces a skeleton rather than arriving out of nothing, and settling the count
and the rows as one unit is what stops them ever being seen to disagree.

Check by eye on `/compare` with no players chosen: the message is at full strength
in the frame it appears - no flash, no dim phase - and the pane itself is
unchanged.
