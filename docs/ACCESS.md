# Access

Who gets into the catalog, and what nobody can take back out of it.

---

## The lock is in Postgres, not in the app

`anon` — the role every browser gets from the public key in `config.js` — holds
no privilege on any table. A stranger who scans a box reaches a locked page, and
behind that page the database returns zero rows to anything they ask.

That distinction is the whole design. A password checked in JavaScript would
have been worth nothing here: the key is printed in a file served from the same
site every sticker points at, and the REST API answers `curl` just as happily as
it answers the app. `gate.live.js` tests exactly this, from a browser that has
never signed in.

## One shared password

Everyone helping shares **one account**. The address in `CREW_EMAIL` is the
account's name, not a mailbox — the app fills it in, so a helper only ever types
the password. Signing in once per device is the whole ceremony; the session
survives a locked phone.

Changing the password on that user is the entire revocation story: everyone
re-enters it once, and nobody's work is orphaned, because who did what is
recorded by **name** rather than by account.

Admin power is deliberately *not* an in-app role. It is the Supabase dashboard
and the service-role key, which one person holds and no password shared with
four people can reach.

## Two settings that are not SQL

`supabase/migration-005-auth.sql` cannot do these, and without the second one it
achieves nothing at all.

1. **Authentication → Users → Add user.** Email must match `CREW_EMAIL`
   (`crew@moving.invalid`), password of your choosing, **Auto Confirm ticked**.
   Nothing is ever sent to that address; `.invalid` is reserved by RFC 2606
   precisely so it can never become someone's real mailbox.

2. **Authentication → Sign In / Providers → "Allow new users to sign up": OFF.**
   It is on the provider page but outside the Email panel, under *User Signups*.
   With signups on, anyone holding the public key calls `signUp()`, becomes
   `authenticated`, and every policy waves them through.

A live test asserts the second one and tells you what to fix if it fails.

## Password advice

It gets said out loud and typed on phone keyboards. Three words joined by
hyphens, lowercase, 16+ characters. No spaces, no punctuation beyond hyphens,
and nothing you use anywhere else — several people will have it.

## What cannot be erased

The shared password means the database cannot tell helpers apart, so the event
log carries a name typed at sign-in. That name is not a credential — it buys no
access — and it is worth something only because the log cannot be edited.

`events` has exactly two policies, `select` and `insert`. There is no update
policy and no delete policy, and RLS denies what it was not told to allow. So
"someone does something, then cleans up after themselves" is not a thing that
can happen: not through the app, not through the console, not with the key in
hand.

Deleting a *thing* is allowed. But `events` carries no foreign key to `things`,
so the row going away leaves `enrolled ZZ4B "espresso machine"` and
`deleted ZZ4B` standing in the log with a name on them.

The one exception is `public.retire_code()`, which is `SECURITY DEFINER`
precisely so that reassigning a label can carry a record's events to its new id.
It renames; it deletes nothing.

## Photos

Storage paths used to be `<ID>.jpg`. The ID is printed on the outside of the
box, so any photo's URL was derivable by anyone who had seen a label — something
no login could have fixed. They are now `<ID>-<random>.jpg`, and the random half
exists only in the `things` row, which needs a session to read.

The bucket takes inserts but no updates and no deletes, so re-photographing
something adds a file and leaves the previous one where it was. An upsert onto a
fixed path was the one way something in this catalog could be destroyed rather
than merely superseded.

**Known limit:** the bucket answers reads without a token, which is what lets
`<img src>` work without threading an expiring signed URL through every view. A
leaked photo URL is still a leaked photo. See [BACKLOG.md](BACKLOG.md) item 7.

## What a scanner sees

Every sticker encodes `HTTPS://ANDREIDAVYDOV.GITHUB.IO/mv/app/#K7M3`, and every
scanner shows that string before opening it — iOS Camera puts the hostname in
the banner. The GitHub username is legible on all 260 printed labels and no
config change alters them; `BASE_URL` is permanent.

What that tells a stranger: a username, and that somebody is moving. Nothing
else, because the catalog behind it is shut.

## Running the tests against a locked catalog

```bash
CREW_PASSWORD=... npm run test:live
```

The password is not in the repo and must not end up there. The live suite writes
to the same database people are using, so each file owns a reserved block of ids
at the end of the space and touches nothing else.
