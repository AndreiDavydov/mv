# What can be done, and what cannot

A UX audit over four things — two containers **A** and **B**, two items **x**
and **y** — covering every state they can be in and every route a person has to
each action. Written against the code as it stands, not as intended.

Everything in §4 and §5 has since been fixed; `app/src/core/capabilities.js` is
now the single place that decides what a thing can do, consulted by the buttons,
by the data layer, and backed by database constraints.

---

## 1. What a single thing can be

| field | values | who sets it |
|---|---|---|
| `id` | one of the 1,048,576 four-character codes | the printed label — **permanent, see §5** |
| `name` | null, or text | ENROLL, Edit, or the Unnamed queue |
| `photo` | null, or a URL in shared storage | ENROLL only |
| `is_container` | false / true | ENROLL, Edit |
| `container_kind` | box, suitcase, crate, bag (containers only) | ENROLL, Edit |
| `parent_id` | null, or a container's code | packing, "Take out" |
| `status` | unpacked / packed / gone | packing, "Take out", "Gone" |
| `tags`, `notes` | free text | Edit |

Two invariants the code maintains: `packed` ⟺ `parent_id` is set, and a
container can never end up inside itself (a Postgres trigger refuses it, so no
client can get it wrong).

## 2. Every legal arrangement of A, B, x and y

Enumerated by machine, not by hand: **27** containment configurations, and
**128** distinct states once `gone` is included.

The 27 split evenly by what the containers are doing:

| container shape | item placements | count |
|---|---|---|
| A and B both loose | x and y each: loose / in A / in B | 9 |
| B inside A | x and y each: loose / in A / in B | 9 |
| A inside B | x and y each: loose / in A / in B | 9 |

`B inside A` with `x in B` is the nesting case that matters in practice: a
suitcase inside a crate, a pan inside the suitcase. The breadcrumb walks it, the
Catalog nests it, and the manifest prints it.

Adding `gone` (any subset of the four, and a gone thing is always loose) brings
it to 128. Every one is reachable, and — since §4 — every route into one is a
deliberate action rather than an accident.

## 3. Every action, and every way to reach it

✅ works · ⚠️ works but wrong · ❌ no route exists

### Creating

| action | route | |
|---|---|---|
| Enrol an unknown code | scan it with the in-app camera | ✅ |
| | phone's stock camera → opens `#ID` → ENROLL | ✅ |
| | type the 4 characters → Look up | ✅ |
| | Bluetooth ring scanner (types the code + Enter) | ✅ |
| Name it | type in ENROLL | ✅ |
| Skip the name | **Quick capture** — photo only, straight to the next code | ✅ |
| Photograph it | shutter on the live viewfinder | ✅ |
| | OS camera, when the in-app one is refused or unavailable | ✅ |
| Skip the photo | just press Save | ✅ |
| Make it a container | *This is a container* toggle, then kind | ✅ |
| Enrol straight into an open box | scan an unknown code while packing | ✅ |

### Finding

| action | route | |
|---|---|---|
| Open a known thing | scan it · type the code · stock-camera link | ✅ |
| | tap it in Catalog, in Search, in a container's contents | ✅ |
| | tap the breadcrumb to walk outward | ✅ |
| | tap the last-scan card on the scanner | ✅ |
| Search | name, tag, note, or the 4-character code | ✅ |
| Filter | unpacked · unnamed · container kind | ✅ |
| See what is in a box | open it — contents grid | ✅ |
| | scan it while packing into it (peek) | ✅ |
| Print a contents list | **Print manifest** on a container | ✅ |
| Clean up quick captures | **Unnamed** tab, type names in sequence | ✅ |

### Changing

| action | route | |
|---|---|---|
| Rename | Edit | ✅ |
| Edit tags / notes / kind | Edit | ✅ |
| Turn an item into a container (or back) | Edit toggle | ✅ |
| Replace the photo | ENROLL is still the only screen that takes one | ❌ |
| Pack something into a box | scan it while packing into that box | ✅ |
| | tap it in the pick-list while packing | ✅ |
| | **Put in a box…** on the item's own page | ✅ |
| Move between boxes | pack it into the other one; logged as unpacked + packed | ✅ |
| Take something out | **Take out** on its page | ✅ |
| Empty a box | **Empty** on a container — everything out, one undoable action | ✅ |
| Mark as gone | **Gone** — a container releases its contents first | ✅ |
| Bring a gone thing back | **Restore** on its page · or scan it while packing, which asks | ✅ |
| Undo | the toast on a pack, for about five seconds | ✅ |
| Undo anything else | ❌ by design — enrolment and edits are deliberate | — |
| Delete permanently | ❌ — nothing is ever hard-deleted except an undone enrolment | — |
| **Move a label to a different thing** | **Move this label…** — see §5 | ✅ |

### Housekeeping

| action | route | |
|---|---|---|
| Start / stop packing | *Pack into this* on a container · *Done* in the banner | ✅ |
| Switch the box being packed | scan a different container → it asks | ✅ |
| Export everything | Backup → Export bundle (JSON + CSV + photos) | ✅ |
| Restore | Backup → Import — **replaces the catalog for everyone** | ✅ |
| Mute the scan tones | Backup → Sound | ✅ |
| Sign in | the locked page — name + shared password, once per device | ✅ |
| Sign out | Backup → *Sign out of this device* | ✅ |
| Read who did what | History on a thing — every event carries a name | ✅ |
| Erase what you did | **impossible** — `events` takes inserts and nothing else | 🔒 |

---

## 4. Where the model used to leak — all fixed

Every rule below now lives in `app/src/core/capabilities.js`, which the buttons,
the data layer and the database all consult. A rule can no longer be enforced by
whether a button happened to be rendered.


### 4.1 A gone container kept its contents — fixed

Marking a box gone now takes everything out of it first. The contents go back to
the catalog loose, as their own `unpacked` events, and it is all one group — so a
single undo puts the box back *and* everything into it. Releasing rather than
refusing: telling someone to empty a box by hand before they may throw it away
is a chore, not a safeguard. A database trigger is the backstop.

### 4.2 Packing resurrected a gone thing, silently — fixed

`packInto` now refuses a gone thing outright, so the rule holds no matter who
calls it. Scanning one while packing asks — *"Old lamp was marked gone. Bring it
back?"* — and its page offers an explicit **Restore**, which returns it loose
rather than silently to whichever box it used to be in.

### 4.3 `status` and `parent_id` could disagree — fixed

`check ((status = 'packed') = (parent_id is not null))`, in migration 002, which
also repairs any row already inconsistent.

### 4.4 No photo after enrolment

Still open. The photo can only be taken on the screen you see once.

---

## 5. Moving a label to something else

Labels get reused: a box is emptied and refilled, a sticker goes on the wrong
thing, a label is peeled off something sold. The code *is* the identity —
`things.id` is the primary key and every event points at it — so freeing one
without destroying its history needed a decision.

**What was built: retire, don't overwrite.** `K7M3` becomes `K7M3-1`, taking its
name, photo, contents and entire history with it, and `K7M3` is free to scan onto
something new. The `-1` suffix is not a code you can scan; it marks a record whose
label has moved on. Reuse it again and the next becomes `K7M3-2`.

```
before   K7M3   "Cast iron pan"   ← the sticker is on the pan
after    K7M3-1 "Cast iron pan"   ← the record, whole, no longer labelled
         K7M3   "Chopping board"  ← the sticker is on the board now
```

Why not a uuid primary key with a reassignable `code` column: it is the textbook
answer and it would work, but it rewrites every query and every foreign key for a
gain that retiring already delivers. Retiring is one CHECK constraint, one
`ON UPDATE CASCADE`, and an id rename — and it survives the same label being
reused any number of times, which is the property that actually matters.

**The flow.** The thing's page offers **Move this label…**, which names what it
is displacing: *"K7M3 currently means 'Cast iron pan'. It keeps its photo, its
contents and its whole history, but loses the label."* Confirm, and the scanner
opens with the code free.

**Interaction with the label sheets.** `printed_up_to` does not move: the code was
already printed, it is only changing meaning. The generator needs to know nothing.

**Requires** `supabase/migration-002-integrity.sql` and
`supabase/migration-003-rules.sql`.

The rename lives in a `SECURITY DEFINER` function rather than in the client. The
event log is append-only by policy — clients may select and insert, nothing else
— but retiring a record has to carry its events across, or the record arrives at
its new id with no past. Relaxing the policy would hand every client the ability
to edit history; one function that does exactly this and nothing else does not.

## 6. Status

| gap | |
|---|---|
| Reassigning a code (§5) | done — needs migration 002 applied |
| Emptying a box | done — **Empty** on a container, one undoable action |
| A gone container keeping its contents (§4.1) | done — contents are released first |
| Packing resurrecting a gone thing (§4.2) | done — refused, and asks; **Restore** added |
| Pack from the item's own page | done — **Put in a box…** |
| `packed ⟺ parent_id` in the database (§4.3) | done — migration 002 |
| Replace a photo (§4.4) | **open** |
| Anyone who scanned a box could read everything | done — migration 005; `anon` holds nothing |
| Who packed this | done — a name from the sign-in, on every event |
| Covering your tracks | impossible by construction — no update or delete policy on `events` |
