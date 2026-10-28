# Cloudflare song library

The `riffoff-library` Worker serves a private `riffoff-songs` R2 bucket. The bucket stores original MP3 bytes as `audio/<sha256>.mp3` and a private `songs.json` playlist. Song names and credentials never belong in this repository.

The static app reads `public/library.json` for the Worker URL. The existing password page exchanges the player's password for a signed 30-day session. The browser remembers the session, never the password. Audio URLs carry that session so native mobile audio can request byte ranges. The Worker supports authenticated `GET`, `HEAD`, single byte ranges (`206`), and unsatisfiable ranges (`416`). Responses are private and not cached by the service worker. Refresh the app and enter the password again after session expiry.

## Publish clips

Store the administrator configuration locally in git-ignored `private/cloudflare-admin.json`:

```json
{ "url": "https://riffoff-library.yoavmil.workers.dev", "token": "<administrator upload token>" }
```

The administrator token is separate from the players' password. `RIFFOFF_LIBRARY_URL` and `RIFFOFF_ADMIN_TOKEN` can supply these settings instead. The deployed endpoint is `https://riffoff-library.yoavmil.workers.dev`.

```powershell
npm run library:upload
```

This reads `private/songs.json` and `private/audio/*.mp3`, uploads clips under content hashes, then publishes the playlist last. `RIFFOFF_PRIVATE_DIR` selects a scratch/private folder; `RIFFOFF_UPLOAD_DIR` can override the upload source specifically. Existing clips are kept so active sessions continue playing during playlist changes. The studio publishes through this same uploader when the local administrator configuration is present.

## Deploy or change secrets

Deploy `worker.mjs` with the Cloudflare plugin, binding `SONGS` to `riffoff-songs` and `LOGIN_LIMIT` to the rate limiter in `wrangler.jsonc`. Set three Worker secrets: `GAME_PASSWORD`, `SESSION_SECRET`, and `ADMIN_TOKEN`. Preserve the existing secret bindings on redeploy. Changing `SESSION_SECRET` revokes all existing sessions; changing only the game password affects new logins. Keep request logging disabled because media query strings carry session credentials.

The supplied `wrangler.jsonc` also supports a Wrangler deployment if CLI credentials are configured. Store secrets with `wrangler secret put`, never in tracked configuration. The initial plugin deployment saves a local recovery copy in ignored `private/cloudflare-secrets.json`.

## Verify

```powershell
npm run test:library
npm run build
```

Tests cover password/session authentication, expiry and revocation, upload credentials, CORS, range responses, rate limiting, client persistence, and failure handling. `npm run library:verify` verifies live MP3 hashes, metadata/order, authentication and byte ranges against the ignored migration export. Supply `RIFFOFF_PASSWORD`, or use the locally saved deployment secrets. All 12 migrated clips were verified before removing `public/vault/`.

## Legacy vault migration

`npm run library:export` decrypts the old committed vault using `RIFFOFF_PASSWORD` into ignored `private/cloudflare-migration/`. It authenticates every AES-GCM file, preserves playlist order, and writes content-hashed MP3 filenames. Run with `RIFFOFF_UPLOAD_DIR` pointing to that export folder to publish it. `RIFFOFF_VAULT_DIR` can point to an archived copy of the old vault once it has been removed from the current checkout. Historical Git commits retain their original encrypted files; this migration does not rewrite repository history.
