# Publishing Tabpass

How Tabpass gets to the Chrome Web Store, and how each update ships. The store copy lives in [`store/listing.md`](../store/listing.md) and [`store/privacy-practices.md`](../store/privacy-practices.md); the privacy policy is [`PRIVACY.md`](../PRIVACY.md).

```
one time:      developer account ─► 2-Step Verification ─► verify migma.ai ─► host privacy policy ─► API keys
each release:  deploy relay ─► bump version ─► build ─► test ─► package ─► tag ─► CI uploads draft ─► submit
```

## One-time setup

### 1. Developer account

1. Use a Google account Migma controls long term, not a person's private account (for example a Workspace account like `extensions@migma.ai`). Everything below hangs off this account.
2. Turn on **2-Step Verification** for it. The store requires it before you can publish or update anything.
3. Open the [developer dashboard](https://chrome.google.com/webstore/devconsole), accept the developer agreement and pay the one-time **US$5** registration fee.
4. Under **Account**:
   - Set the publisher name to `Migma`.
   - Add and verify the contact email (the store sends a link).
   - Complete the trader declaration. Migma is a business, so declare as a trader. The address, email and phone you give are shown on the listing to EU users.
5. Optional, so several people can manage the item: create a **group publisher** linked to a Google Group, and publish from it.

### 2. Verify migma.ai (official URL)

A verified site shows as the publisher's official URL on the listing, which helps people trust an extension that asks to read every site.

1. Sign in to [Google Search Console](https://search.google.com/search-console) **with the same Google account** as the developer account (or add it as an owner of an existing migma.ai property).
2. Add a **Domain** property for `migma.ai` and add the TXT record it gives you to migma.ai's DNS. Leave the record in place after it verifies.
3. In the dashboard, on the item's **Store listing** tab, pick `migma.ai` under **Official URL**. The list only shows sites verified for this account; **Add a new site** opens Search Console.

The "Established publisher" badge is separate. Google grants it on its own to verified publishers with a good track record; it cannot be requested.

### 3. Host the privacy policy

The **Privacy practices** tab needs a public URL. Publish `PRIVACY.md` at `https://migma.ai/tabpass/privacy` (or link the file on GitHub once the repository is public) and keep it in sync with this repo. Its answers must match `store/privacy-practices.md`.

### 4. API credentials for CI

The release workflow uses [`chrome-webstore-upload-cli`](https://github.com/fregante/chrome-webstore-upload-cli) 4.x, which calls the Chrome Web Store API **v2** (the v1.1 API was supported until 15 October 2026). It needs five values.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (e.g. `tabpass-release`) under the same Google account.
2. Enable the **Chrome Web Store API** (`chromewebstore.googleapis.com`).
3. Configure the OAuth consent screen (**Google Auth Platform**):
   - Choose **Internal** if migma.ai is a Google Workspace domain.
   - Otherwise choose **External** and then **publish the app to Production**. In "Testing" mode, refresh tokens expire after 7 days and CI breaks every week.
4. Create an OAuth client of type **Desktop app**. Keep its client ID and client secret.
5. Run `npx chrome-webstore-upload-keys`, enter the client ID and secret, and sign in with the developer account. It prints the refresh token.
6. Find the **publisher ID** on the dashboard's Account page; it is also in the dashboard URL after `/devconsole/`.
7. The **extension ID** is the item ID, shown after the first upload (below).

Add them in GitHub under **Settings > Secrets and variables > Actions**:

| Secret | Value |
|---|---|
| `CWS_EXTENSION_ID` | Item ID, 32 letters a–p |
| `CWS_PUBLISHER_ID` | Publisher ID from the Account page |
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token from step 5 |

Then create an environment named **`chrome-web-store`** (Settings > Environments) and add required reviewers, so every store upload waits for a person's approval. You can store the five secrets on that environment instead of the repository, so no other workflow can read them.

These keys can upload and publish **every** item of this publisher. Revoke the OAuth client in Cloud Console if they leak.

## Before each release

1. **Deploy the relay first** (`cd relay && yarn deploy:worker`, see the README), and make sure it still accepts the version of the extension people have now (the relay refuses old extensions with an "update" message, so a breaking protocol change needs a relay that speaks both). `RELAY_SECRET` must stay the same across deploys, or every signed-in tool has to sign in again. Check:
   - `curl -sS https://tabs.migma.ai/health` answers.
   - WebSocket upgrades work on `wss://tabs.migma.ai/extension`.
2. **The store build must default to `wss://tabs.migma.ai/extension`.** `scripts/package.mjs` refuses a build whose default relay is not `wss://`.
3. **Bump the version** in both `extension/public/manifest.json` and `extension/package.json` (same value, higher than the version in the store).
4. **New permissions?** Users get a warning and Chrome disables the extension until they accept, and the review takes longer. Add a justification to `store/privacy-practices.md`. If what leaves the browser changes, update `PRIVACY.md` and tell users in the extension before it applies.
5. **Build the store version** (not `build:dev`):
   ```bash
   yarn --cwd extension build
   ```
6. **Run the tests:**
   ```bash
   yarn test        # relay tests and typechecks
   yarn test:e2e    # real Chromium (rebuilds extension/dist as a dev build!)
   ```
   `yarn test:e2e` overwrites `extension/dist` with a dev build, so build the store version again afterwards.
   If the UI changed, make the store images again (`cd e2e && xvfb-run -a node store-assets.mjs`; it builds its own production copy) and upload the new ones with the release.
7. **Package:**
   ```bash
   node scripts/package.mjs
   ```
   It checks the build (no "(dev)" name, no localhost in `externally_connectable`, no `key`, versions match, every icon and referenced file present, default relay over `wss://`) and writes `release/tabpass-<version>.zip` with `manifest.json` at the root. It prints the size and SHA-256. `--check` validates without writing.
8. **Smoke test the zip** in a fresh Chrome profile: unzip, **Load unpacked**, and check that the panel says "Connected", a tool can sign in with `https://tabs.migma.ai/mcp`, the site prompt appears, and no Migma Connect row is shown. Migma account connections remain development-only until Migma's integration ships.
9. **Tag and push:**
   ```bash
   git tag extension-v0.3.0 && git push origin extension-v0.3.0
   ```
   The release workflow builds, packages, attaches the zip to a GitHub Release, and uploads it to the store as a draft.

## First submission

The API cannot create an item, so the first upload is by hand.

1. Dashboard > **New item** > upload `release/tabpass-<version>.zip`.
2. **Package** tab: note the **item ID** (this is `CWS_EXTENSION_ID`) and open **View public key** if you want a stable development ID (see below).
3. **Store listing** tab, from `store/listing.md`:

   | Field | Source |
   |---|---|
   | Name, summary | From the package (`name`, `description` in the manifest) |
   | Description | `store/listing.md` > Description |
   | Category, language | `store/listing.md` |
   | Store icon | `extension/public/icons/icon-128.png` |
   | Screenshots (1–5, 1280x800) | `store/images/01-home.png` … `05-dark.png`, in that order |
   | Small promo tile (440x280) | `store/images/promo-small-440x280.png` |
   | Marquee (1400x560) | Optional: `store/images/promo-marquee-1400x560.png` |
   | Official URL | `migma.ai` (after verification) |
   | Homepage, support URL | `store/listing.md` > URLs |

4. **Privacy practices** tab: paste every answer from `store/privacy-practices.md`, tick the three certifications, and add the privacy policy URL.
5. **Test instructions** tab (if shown): paste the reviewer steps from `store/privacy-practices.md`.
6. **Distribution** tab: free, all regions, and visibility:
   - **Private** first, with the Migma team (and a Google Group of early testers) as trusted testers. Add testers on the Account page; each needs a Google account.
   - **Unlisted** next: anyone with the link can install, nothing shows in search. Good for Migma's connect page and early users.
   - **Public** once the hosted relay has carried real traffic and the listing is right.

   The API cannot change visibility, and "publish" always uses the visibility set here. After you change visibility, publish once from the dashboard before CI can publish again.
7. **Submit for review.** Untick "publish automatically after approval" if you want to choose the moment yourself.
8. After it is approved, put the item ID in `CWS_EXTENSION_ID`, and give the store link to Migma (the connect page and "Use my browser" button need the store ID, see `docs/migma-integration.md`).

## Review: what to expect

- Most reviews take a few days; some take a few weeks. Google gives no fixed time.
- Tabpass gets the **in-depth review**: `<all_urls>` host access, `scripting` and `tabs` together are exactly what triggers it. New publishers and big code changes add time too. Plan for one to three weeks the first time.
- What helps: one clear purpose, a justification for each permission that says when it is used, a privacy policy that matches the Privacy tab, and readable code (the side panel bundle is minified; the service worker and page script ship as written).
- A rejection email names the policy (for example excessive permissions or missing disclosure). Fix it and resubmit, or appeal from the dashboard's support link. Rejections make the next review slower, so fix the cause rather than resubmit quickly.
- Every update is reviewed again. Updates that add permissions take longer.
- The store can also remove an item later if its behavior stops matching the listing, so keep `store/` and `PRIVACY.md` true.

A smaller footprint would likely shorten review: declaring `<all_urls>` under `optional_host_permissions` and requesting each site when the person clicks "Always allow" or "Allow for 10 minutes" in Tabpass's prompt (a click in an extension page counts as the user gesture Chrome needs). That changes the approval flow, so it is a product decision, not a release step.

## Updating through CI

`.github/workflows/release-extension.yml` runs on a tag `extension-v*` or by hand (**Actions > Release extension > Run workflow**).

| Run | What happens |
|---|---|
| Tag push, or manual with `mode: upload` (default) | Builds, packages, keeps the zip as a workflow artifact, attaches it to the GitHub Release (tags only), and uploads it to the store **as a draft**. Nothing reaches users. Submit it from the dashboard. |
| Manual with `mode: publish` | The same, then submits for review. After approval it goes live to the visibility set in the dashboard: trusted testers only while the item is Private. |
| `deploy_percentage` | Publish only: roll out to a share of users first. The store offers this only to items with more than 10,000 users; raise it later in the dashboard. |

The store job waits for approval on the `chrome-web-store` environment if reviewers are set. CI only checks the store build (`node scripts/package.mjs --check`) on every push, so a broken package is caught before a tag.

To cancel a submission that is in review, use the dashboard.

## Keep a stable extension ID for development

An unpacked build gets an ID from its folder path, so it changes between machines and folders. Migma's site talks to Tabpass by extension ID (`chrome.runtime.sendMessage(extensionId, …)`), so testing against the real migma.ai needs the store's ID. The manifest `key` field pins it.

1. Dashboard > item > **Package** > **View public key**.
2. Copy the text between `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----` and remove the line breaks, so it is one line.
3. Add it as `"key"` to the manifest of a **local development build only** (for example a git-ignored overlay that the dev build merges in). Do not commit it to `extension/public/manifest.json`.
4. Load the unpacked build and check that the ID on `chrome://extensions` equals the item ID.

Why it must not be in the store build:

- The store gives the item its ID from its own key. A package that carries a `key` can be refused, so `scripts/package.mjs` refuses it first.
- A dev build with the store's ID collides with the store install in the same profile. Use a separate Chrome profile for development.
- If you only need *a* stable ID (not the store's), generate your own key pair for development instead, so dev and store installs can live side by side.

## Microsoft Edge Add-ons (optional)

Edge runs Chrome extensions, so the same zip works.

1. Register in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/) as an Edge extension developer (no fee). A Microsoft or GitHub account works.
2. Create a new extension, upload `release/tabpass-<version>.zip`, and reuse the listing text, images and privacy answers. The privacy policy URL is the same.
3. Edge gives the extension **a different ID**. Migma's site must accept both IDs (Chrome and Edge) when it calls `chrome.runtime.sendMessage`.
4. Review usually takes several business days.
5. Updates can be automated later with the Edge Add-ons API (v1.1, an API key and client ID from Partner Center's Publish API page). The first submission is always by hand.

Check on Edge before listing: the side panel, the site prompt window, and that `externally_connectable` from migma.ai reaches the Edge ID.
