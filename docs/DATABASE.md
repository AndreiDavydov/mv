# Database

One Postgres database on Supabase, shared by every device. The site on GitHub
Pages is static; all state lives here, and every open screen subscribes to it.

Project `sqwbpeltdjyjrclrgejp`. Access rules are in [ACCESS.md](ACCESS.md).

---

## Tables

### `things` — what exists, and where it is

Everything is a thing. Containers are things. There is **no separate box
table** — a suitcase inside a crate is two rows and a `parent_id`, and splitting
containers from items makes that arrangement impossible to express.

```
id              text     PK, the 4-char code (or `K7M3-1` for a retired record)
name            text
photo_url       text     storage URL, unguessable path
thumb_url       text
is_container    boolean
container_kind  text     'box' | 'suitcase' | 'crate' | 'bag'
parent_id       text     FK -> things.id
tags            text[]
room            text     no longer written; the column stays, see below
notes           text
status          text     'unpacked' | 'packed' | 'gone'
created_at      timestamptz
updated_at      timestamptz    maintained server-side, so clocks cannot disagree
```

### `events` — append-only history

```
id         bigint identity
thing_id   text
type       text   'enrolled' | 'packed' | 'unpacked' | 'renamed' | 'moved' | 'deleted'
parent_id  text   the container involved
payload    jsonb  the group id, and before/after for undo
actor      text   the name typed at sign-in
ts         timestamptz
```

The most important design decision in the project. It gives undo for free, a
real audit trail, and a record that survives the row it describes.

**No foreign key to `things`, deliberately.** Undoing an enrolment deletes the
thing, and the log has to outlive it — history that disappears with the row is
not history.

**Nothing mutates `things` without writing a matching event.**

## What the database enforces itself

Rules that live in the app can be forgotten by the next person who writes a
query. These cannot:

| rule | how |
|---|---|
| A container cannot end up inside itself | `check_no_cycle` trigger, walks the chain |
| `packed ⟺ has a parent` | check constraint |
| A `container_kind` belongs only to a container | check constraint |
| Only an open container may contain things | trigger |
| A box may be deleted *with* its contents, never out from under them | deferred FK, `on delete no action ... deferrable initially deferred` |
| The event log can only be appended to | RLS: a select policy, an insert policy, nothing else |
| Ids are well-formed | check constraint on the alphabet |

`app/src/core/capabilities.js` is the app-side mirror of the same rules — one
place that both the buttons and the writes consult, so a button is never offered
for something the database will refuse. [STATES.md](STATES.md) has the full
state space.

## Migrations

Run in order in the Supabase SQL editor. All are idempotent and repair rows
already in a bad state, so re-running one is harmless.

| file | what it does |
|---|---|
| `supabase/schema.sql` | tables, cycle guard, realtime, access rules, photo bucket |
| `migration-002-integrity.sql` | `packed ⟺ in a box`; retired-label ids; contents follow a rename |
| `migration-003-rules.sql` | only an open container can contain; a kind belongs to a container; `retire_code()`, the one function allowed to touch the log |
| `migration-004-delete-fix.sql` | a box may be deleted with its contents, never out from under them |
| `migration-005-auth.sql` | closes the catalog: `anon` loses every privilege. **Its header names two dashboard settings that are not SQL** — see [ACCESS.md](ACCESS.md) |

All five are applied to the live project.

The live tests skip themselves by name when a migration is missing, rather than
failing or — worse — passing.

`supabase/cleanup-test-data.sql` clears the reserved `ZZ*` block the live suite
writes into.

## Reassigning a label

A sticker outlives the thing it was stuck to. Scanning `K7M3` and choosing
*This is something else* renames the existing record to `K7M3-1` and frees
`K7M3` for a new object — history, photos and contents travel with the old
record to its retired id.

This is the one operation permitted to move rows in an append-only log, which is
why it is a `SECURITY DEFINER` function (`retire_code()`) rather than two
updates from the client: relaxing the policy would hand every client the ability
to rewrite history. The alternative — a surrogate uuid primary key — would have
rewritten every query in the app for a gain that retiring already delivers.

Full walkthrough in [STATES.md §5](STATES.md).

## Realtime

Both tables are in the `supabase_realtime` publication with `replica identity
full`. `RemoteCatalog.onChange` subscribes to both, and the app coalesces the
redraw over 120 ms — packing a box emits two writes in a row and redrawing twice
makes the list flicker.

This is what makes a scan on a phone appear on a laptop with no reload.

## Capacity and cost

Rows are tiny — a thing is a few hundred bytes, an event less. Photos dominate,
and they are downscaled before upload (~800 px long edge for the record, ~200 px
for the thumbnail), so a few hundred items is single-digit megabytes. Nothing
about a house move approaches the free tier.

Two operational facts that will look like bugs:

- **Free projects pause after about a week idle.** Over a multi-week move this
  will happen: the app shows "No connection to the catalog" and it takes a click
  in the Supabase dashboard to wake it.
- **The catalog view fetches every row on each refresh.** Fine at 260 labels
  (~100 kB); past a couple of thousand it wants pagination.

## Backups

Browser storage is not a place to keep the only copy of anything, and neither is
somebody else's Postgres. **Catalog → Export bundle** produces one ZIP holding
`catalog.json`, `catalog.csv` and every photo as `photos/<ID>.jpg` — readable
without this app and without the database. Commit it into `backups/` and the
move is recorded for good.

Import restores from that bundle and **replaces the catalog for everyone**, so
it asks first.
