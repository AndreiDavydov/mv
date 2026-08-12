# What can be done, and what cannot

A UX audit over four things — two containers **A** and **B**, two items **x**
and **y** — covering every state they can be in and every route a person has to
each action. Written against the code as it stands, not as intended; the gaps at
the end are real.

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
it to 128. Every one of those 128 is reachable — but see §4.2 and §4.3, because
two of the routes into them are wrong.

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
| Replace the photo | ❌ — ENROLL is the only screen that takes one | ❌ |
| Pack something into a box | scan it while packing into that box | ✅ |
| | tap it in the pick-list while packing | ✅ |
| | **from the item's own page** — "put this in…" | ❌ |
| Move between boxes | pack it into the other one; logged as unpacked + packed | ✅ |
| Take something out | **Take out** on its page | ✅ |
| Empty a box | ❌ — only one item at a time, from each item's page | ❌ |
| Mark as gone | **Gone** on its page, behind one confirmation | ✅ |
| Bring a gone thing back | ❌ from the UI — but see §4.2 | ⚠️ |
| Undo | the toast on a pack, for about five seconds | ✅ |
| Undo anything else | ❌ by design — enrolment and edits are deliberate | — |
| Delete permanently | ❌ — nothing is ever hard-deleted except an undone enrolment | — |
| **Reassign a code to a different thing** | ❌ — see §5 | ❌ |

### Housekeeping

| action | route | |
|---|---|---|
| Start / stop packing | *Pack into this* on a container · *Done* in the banner | ✅ |
| Switch the box being packed | scan a different container → it asks | ✅ |
| Export everything | Backup → Export bundle (JSON + CSV + photos) | ✅ |
| Restore | Backup → Import — **replaces the catalog for everyone** | ✅ |
| Mute the scan tones | Backup → Sound | ✅ |

---

## 4. Where the model leaks

### 4.1 A gone container keeps its contents

`Gone` clears the thing's own `parent_id` but does nothing to its children. Mark
box **A** gone while **x** is inside it and the catalog shows a struck-through
box that still contains something — and `x` still says `packed`, in a box that
no longer exists.

Right behaviour: marking a container gone should take everything out of it first
(each as its own `unpacked` event), or refuse while it is not empty. Refusing is
probably better: "A still has 2 things in it. Take them out first."

### 4.2 Packing resurrects a gone thing, silently

The pick-list correctly hides gone things. **Scanning does not.** Scan a gone
item while packing and `packInto` writes `status: 'packed'` over `gone` with no
comment — so the one route back from gone is an accident, and there is no
deliberate one.

Right behaviour: scanning a gone thing while packing should ask — "x was marked
gone. Put it back?" — and a `Gone` page should offer an explicit **Restore**.

### 4.3 `status` and `parent_id` can disagree in principle

Nothing in the database enforces `packed ⟺ parent_id is not null`. The client
always sets them together, so it holds today, but an import or a future writer
could break it. A `CHECK` constraint would make it true rather than customary.

### 4.4 No photo after enrolment

The photo can only be taken on the screen you see once, at the moment you first
scan the label. Get a bad shot and there is no way back to it. Edit should take
one.

---

## 5. Reassigning a code — the real problem

Labels get reused. A box is emptied at the destination and refilled with
something else. A label peels off and goes on a different thing. A label was
stuck on the wrong item in the first place. Today none of that is possible:
enrolling a code that exists fails with *"already enrolled"*, and there is no
other route.

**Why it is not a small fix.** The code *is* the identity — `things.id` is the
primary key and every event points at it. Reassigning a code therefore means one
of:

| option | what happens to the old thing's history | cost |
|---|---|---|
| **(a) Overwrite in place** — clear name/photo/parent, keep the row | destroyed; the log now describes two different objects under one id | trivial |
| **(b) Archive then reuse** — copy the old thing aside, free the code | preserved, but the archived copy has no code, so nothing can be scanned to reach it | small migration |
| **(c) Separate identity from label** — `things.thing_id` (uuid) as the key, `things.code` as a reassignable unique field | preserved and intact; the old thing stays in the catalog, codeless, with its full history | one migration, touches every query |

**(c) is the correct model** and the only one that survives a second reuse of
the same label. It is also the one that makes "this label is now on something
else" an ordinary event rather than a special case:

```
things:  thing_id (uuid, pk) · code (text, unique, nullable) · …
events:  thing_id → things.thing_id
```

Reassigning becomes: clear `code` on the old row, set it on the new one, write a
`recoded` event on both. The old thing remains searchable and keeps its photos
and history; it simply has no label any more, which is exactly what is true of
it in the physical world.

**Recommended flow.** Scanning a code that is already enrolled shows the thing,
as it does now. Its page gains **This label is on something else now** →
confirm → the old thing loses the code and the ENROLL screen opens on it fresh.
The confirmation must name what it is displacing: *"K7M3 currently means 'Cast
iron pan'. It will keep its history but lose its label."*

**Interaction with the label sheets.** Reuse and fresh printing are different
things. `printed_up_to` must not move when a code is reassigned — the code was
already printed, it is only changing meaning. Nothing in the generator needs to
know.

---

## 6. Ranked gaps

1. **Reassigning a code** (§5) — the whole point of a durable label is that it
   outlives its first use. Needs the identity migration.
2. **Emptying a box** — the move has a second half and there is no support for
   it. Scan a box → *Unpack all*, or tick items off as they come out.
3. **A gone container keeps its contents** (§4.1) — produces a state the model
   says is impossible.
4. **Packing silently resurrects a gone thing** (§4.2) — plus no deliberate
   Restore.
5. **Pack from the item's own page** — the only way to put x in A is to be
   holding x with the camera open, or to be already packing A.
6. **Replace a photo** (§4.4).
7. **`packed ⟺ parent_id` as a database constraint** (§4.3).
