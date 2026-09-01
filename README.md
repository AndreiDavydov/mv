# Moving — a QR catalog for a house move

Stick a numbered QR label on everything you own. Scan one with a phone and the
catalog opens on that item: what it is, what it looks like, which box it is in.
Scan an item while packing a box and it goes in the box. The catalog is shared,
so a scan on a phone in the cellar appears on the laptop upstairs immediately.

**Live: https://andreidavydov.github.io/mv/app/** — private, one shared password.

---

## How it works

Labels are printed in bulk as **anonymous 4-character codes** with no meaning.
A code acquires meaning the first time somebody scans it. So 260 stickers can go
onto boxes today and be enrolled over the following weeks.

```
  phone                    laptop                 anyone's browser
    │                        │                          │
    └────────────┬───────────┴──────────────────────────┘
                 │  supabase-js  (REST + realtime socket)
                 ▼
       ┌───────────────────────────────────┐
       │  things   what exists, and where  │
       │  events   append-only history     │
       │  storage  photos                  │
       └───────────────────────────────────┘
```

Everything is a *thing*. Boxes are things too — a suitcase inside a crate is two
rows and a `parent_id`, not two tables. Every change writes an event, and the
event log can only be appended to, which is where undo comes from and why
nobody can quietly erase what they did.

There is **no offline mode**. A shared catalog needs the network, so writes fail
loudly rather than queueing: a pack that silently lands ten minutes later is
worse than being told to move two metres.

## Where this stands

| | |
|---|---|
| Live | https://andreidavydov.github.io/mv/app/ |
| Database | Supabase `sqwbpeltdjyjrclrgejp`, migrations 002–005 applied |
| Access | private — one shared password, `anon` holds nothing |
| Catalog | empty — the test rows were cleared before the first real print |
| Labels printed | 4 sheets, 260 labels, `2222` … `22A5` |
| Next free code | `22A6` |
| Tests | 129 unit (~0.2 s) · 68 live (~2 min) |

**The one thing never tested:** whether the printed labels actually scan off
paper. Stick five and try them in the worst light you will really work in.
Details and the three fallbacks: [docs/LABELS.md](docs/LABELS.md).

## Getting started

```bash
npm install
npm run vendor     # bundles deps into /vendor (output is committed)
npm test           # 129 unit tests, no browser, no network
npm run serve      # http://localhost:8087/labels/  and  /app/
```

Full setup, scripts, and the layout of the code: [docs/DEVELOPING.md](docs/DEVELOPING.md).

## Documentation

| | |
|---|---|
| [docs/LABELS.md](docs/LABELS.md) | printing labels — the paper, the geometry, QR sizing, which codes are used up |
| [docs/ACCESS.md](docs/ACCESS.md) | who gets in, what nobody can erase, the Supabase settings that are not SQL |
| [docs/DATABASE.md](docs/DATABASE.md) | the schema, the migrations, what the rules are enforced by |
| [docs/DEVELOPING.md](docs/DEVELOPING.md) | running it, testing it, and how the code is arranged |
| [docs/STATES.md](docs/STATES.md) | every state a thing can be in, every action, and every route to it |
| [docs/DECISIONS.md](docs/DECISIONS.md) | where the build departs from the original brief, and why |
| [docs/BACKLOG.md](docs/BACKLOG.md) | what is done and what is still open |
| [docs/HANDOVER.md](docs/HANDOVER.md) | the original brief this was built from |

## Repository

```
config.js       BASE_URL, ID alphabet, container kinds — the permanent settings
shared/         used by both the label generator and the app
labels/         the label sheet generator: open index.html, print
app/            the catalog itself
supabase/       schema and migrations
proofs/         printable artefacts, screenshots, the printed-labels ledger
backups/        exported bundles, committed
```
