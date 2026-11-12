# The Giving List

A small, invite-only Secret Santa wishlist for **https://secret-santa.bellee.net**.

- Google and Facebook sign-in only; no passwords or email sign-up.
- One private group, protected by an invitation code.
- A short name and up to three gifts per person: distinct gift links, or gift cards (link optional).
- **AUD $50 maximum per gift**, not $50 across all three. Prices are entered manually; the app does not fetch shops or verify current prices.
- Optional descriptions, with up/down controls for preference. Number 1 is most wanted.
- Group members can view each other's saved wishlists. This app does not draw Secret Santa assignments or track purchases.
- Mobile-friendly React frontend, a small Node backend, and a single SQLite database on the NAS.

## Why a backend and SQLite?

Cookies alone cannot share wishlists with other participants or restore them on another device. The backend verifies social sign-in and stores profiles and gifts in SQLite. There is no separate database service. A secure, HttpOnly cookie holds only a random session identifier, not the profile or social credentials. Sessions last 30 days; sign-out revokes the current session.

Google and Facebook identities are separate accounts, even if they belong to the same person. Use the same provider each time. Signing in on another device restores the same profile.

## Local development

Requires **Node.js 24+** and npm. The app uses Node's built-in SQLite and TypeScript support.

```sh
npm ci
cp .env.example .env
```

In `.env`, set a **random** `GROUP_INVITE_CODE` of 12–200 characters, e.g. `openssl rand -hex 16`. Don't use a memorable phrase; the server can't check how guessable a code is. Configure social credentials as described below. Keep `.env` private; never commit it.

Run these in two terminals:

```sh
npm run dev
```

```sh
npm run dev:ui
```

Open **http://localhost:5173**. Vite proxies `/auth` and `/api` to port 3000. Use the development callback URL `http://localhost:5173/auth/google/callback` or `http://localhost:5173/auth/facebook/callback` in the relevant provider's settings. Facebook may require HTTPS for your app configuration; use the production HTTPS site for Facebook if it rejects localhost.

With no credentials, the landing page works but sign-in buttons are explicitly unavailable. There is deliberately **no mock or bypass login**.

```sh
npm run build
npm test
```

For a local single-server production-build preview, build first and set `APP_ORIGIN=http://localhost:3000` with `NODE_ENV=development`, then run `npm run dev`. Do not use development mode for an internet-facing deployment.

## Social sign-in setup

Use your own OAuth apps. Do not send secrets through chat or put them in the frontend.

### Google

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen / Google Auth Platform.
2. Create an OAuth client of type **Web application**.
3. Add this exact authorised redirect URI:
   `https://secret-santa.bellee.net/auth/google/callback`
4. Configure the app's public home and privacy URLs where requested:
   `https://secret-santa.bellee.net/` and `https://secret-santa.bellee.net/privacy`.
5. Add the domain `bellee.net` and complete domain verification if Google requests it.
6. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. While the consent screen is in testing, explicitly add participants as test users, or publish the app for the intended audience.

The app requests `openid profile`, uses an authorisation code with PKCE, and stores only Google's account identifier, not the returned profile or token.

### Facebook / Meta

1. In [Meta for Developers](https://developers.facebook.com/apps/), create an app/use case supporting **Facebook Login for a website**.
2. Configure Facebook Login's valid OAuth redirect URI:
   `https://secret-santa.bellee.net/auth/facebook/callback`
3. Add the website URL `https://secret-santa.bellee.net/` and app domain `secret-santa.bellee.net` (or its parent if the console requests it).
4. Set the privacy policy URL to `https://secret-santa.bellee.net/privacy`.
5. Select the user-data-deletion **instructions URL** option and enter `https://secret-santa.bellee.net/data-deletion`. This site supplies instructions, not Meta's signed-request deletion callback.
6. Put the App ID and App Secret in `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET`.
7. `FACEBOOK_GRAPH_VERSION` defaults to `v24.0`. Confirm that this version remains supported for your app, or set a supported version in `.env`.
8. Complete Meta's required app settings, verification/review where applicable, and switch to Live mode for ordinary participants. In Development mode, only permitted app roles/testers can sign in. Use [branding/app-icon-1024.png](branding/app-icon-1024.png) as the 1024×1024 app icon. Its source is `branding/app-icon.svg`.

Meta checks that the privacy and data-deletion URLs load, and rejects them as "not a valid URL" while the site is offline. Deploy first, then enter them. Both pages are served as plain HTML without JavaScript, so Meta's and Google's checkers can read them.

Only the basic `public_profile` permission is requested. The site stores Facebook's app-scoped ID, not an email address or access token.

The provider consoles and approval requirements change independently of this app. Test both providers with a real, non-administrator participant before inviting the whole group. The public privacy copy describes this app's behaviour; review it for your own operator/contact and retention obligations.

## Synology Container Manager deployment

Requires an x86-64 NAS that supports Container Manager / Docker. No cloud hosting or cloud database is required.

### Container image (GitHub Actions)

[.github/workflows/docker.yml](.github/workflows/docker.yml) runs on every push to `main`. It typechecks, builds and tests the app, then builds a `linux/amd64` image and publishes it to GitHub Container Registry:

- `ghcr.io/cbellee/secret-santa:latest`: the latest `main`
- `ghcr.io/cbellee/secret-santa:sha-<short-sha>`: one tag per commit, useful for pinning or rolling back

Pull requests are built and tested but not published. The workflow uses the built-in `GITHUB_TOKEN`, so no repository secrets are needed.

The repository and package are **public**, so the NAS can pull the image without logging in to GitHub.

### Running it on the NAS

1. Create a folder such as `/volume1/docker/secret-santa` and copy in **only `docker-compose.yaml`** (Container Manager only recognises this name, not `compose.yaml`). The source code isn't needed; the image comes from GHCR.
2. Create a private `.env` beside `docker-compose.yaml`:

   ```dotenv
   APP_ORIGIN=https://secret-santa.bellee.net
   GROUP_INVITE_CODE=replace-with-your-random-private-code
   GOOGLE_CLIENT_ID=your-google-client-id
   GOOGLE_CLIENT_SECRET=your-google-client-secret
   FACEBOOK_CLIENT_ID=your-facebook-app-id
   FACEBOOK_CLIENT_SECRET=your-facebook-app-secret
   FACEBOOK_GRAPH_VERSION=v24.0
   CLOUDFLARE_TUNNEL_TOKEN=your-cloudflare-tunnel-token
   ```

3. In **Container Manager → Project → Create**, select the folder and `docker-compose.yaml`, then start it. Alternatively, over SSH in that folder:

   ```sh
   docker-compose up -d
   docker-compose ps
   docker-compose logs --tail=50 secret-santa
   ```

   Synology ships Compose as the standalone `docker-compose` command, and Docker commands need `sudo` over SSH.

   To deploy a new version after a push has finished building:

   ```sh
   sudo docker-compose pull && sudo docker-compose up -d
   # Confirm the running commit (matches the short SHA shown in GitHub):
   sudo docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' $(sudo docker-compose ps -q secret-santa)
   ```

   In Container Manager, update the image under **Image** (**Update** when it shows "Update available"). Then use **Project → Action → Stop**, followed by **Build**.

4. Check the internal listener from the NAS:

   ```sh
   curl -f http://127.0.0.1:3080/api/session
   ```

   It should return an anonymous session and configured provider availability.

The container runs as an unprivileged user with a read-only root filesystem. SQLite lives in the persistent **`santa-data` named volume**, mounted at `/app/data`. Container recreation and normal `docker-compose down` preserve it. **Do not run `docker-compose down -v` or delete that volume** unless you intend to erase profiles and wishlists.

### Public access via Cloudflare Tunnel (recommended)

`bellee.net` is on Cloudflare, so the Compose project includes a `cloudflared` container that opens an **outbound-only** tunnel. You need **no router port forwarding, no DSM reverse proxy and no NAS certificate**, and your home IP is not published. It also works behind CGNAT.

1. Cloudflare dashboard → **Networking → Tunnels → Create Tunnel**, name it e.g. `nas-secret-santa`.
2. Under **Setup Environment**, choose **Docker** and copy only the token (the long value after `--token`). Put it in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`. Treat it like a password; anyone with it can serve content on your hostname.
3. In **Networking → Tunnels**, select the tunnel. Under **Routes**, choose **Add route → Published application**:
   - Hostname: subdomain `secret-santa`, domain `bellee.net`, path empty.
   - Service URL: **`http://secret-santa:3000`**.

   Don't use **Networking → Routes → Tunnel Hostname**; that type is for private hostnames, not a public website.

   Cloudflare creates the proxied DNS record `secret-santa.bellee.net` → `<tunnel-id>.cfargotunnel.com` automatically. Don't create it by hand, and don't add an A record for the same name.
4. Start or restart the project (`docker-compose up -d`), then check `docker-compose logs --tail=50 cloudflared` for `Registered tunnel connection`.
5. In the `bellee.net` zone:
   - **SSL/TLS → Edge Certificates:** turn on **Always Use HTTPS**; set Minimum TLS to 1.2.
   - **Speed → Optimization:** keep **Rocket Loader off**. It rewrites scripts, which the app's Content-Security-Policy blocks.
   - Leave caching at the defaults. Cloudflare does not cache HTML or `/api` JSON by default, and the API sends `Cache-Control: no-store`. Don't add "cache everything" rules for this hostname.
6. Visit `https://secret-santa.bellee.net`, test both social sign-ins, join with the invitation code, save gifts, and check them from another member's account.

**Keep the tunnel pointed directly at `secret-santa:3000`.** Cloudflare appends the real visitor IP as the last `X-Forwarded-For` entry, and the app trusts exactly one proxy hop (`cloudflared`), so per-IP rate limits see the real visitor. Routing the tunnel through DSM's reverse proxy or another proxy adds a hop. Every visitor would then share one rate-limit bucket.

**Router and NAS:** no MikroTik changes are needed if it allows normal outbound traffic. `cloudflared` connects out on port 7844 (UDP/QUIC, falling back to TCP) and 443. If you have strict egress filter rules, allow the NAS outbound on those ports. Don't forward any port for this app. The DSM firewall only filters inbound traffic, so it needs no change.

Consider pinning `cloudflare/cloudflared` to a specific version tag, and update it periodically alongside the app.

### Alternative: port forwarding with DSM reverse proxy

Use this only if you can't use a tunnel. If router port 443 already goes to another device (for example for your existing `edge`/`ev` hostnames), this hostname needs to share that device's reverse proxy instead.

1. Remove the `cloudflared` service from `docker-compose.yaml`.
2. In Cloudflare DNS, add `CNAME secret-santa → <your-router>.sn.mynetname.net` (your MikroTik IP Cloud name), with proxy status **DNS only (grey cloud)**. Turning on the orange-cloud proxy here would make the app see Cloudflare's IPs instead of visitors' IPs. That needs a different trust-proxy setting, plus an origin firewall that only accepts Cloudflare.
3. On the MikroTik, forward WAN TCP 443 (and 80 if Let's Encrypt HTTP validation is used) to the NAS. The default firewall already accepts dst-NAT traffic. Add a hairpin-NAT rule if LAN clients should use the public name:

   ```
   /ip firewall nat add chain=dstnat in-interface-list=WAN protocol=tcp dst-port=443 action=dst-nat to-addresses=<NAS-LAN-IP> to-ports=443 comment="secret-santa HTTPS"
   ```

4. In DSM **Control Panel → Security → Certificate**, add a Let's Encrypt certificate for `secret-santa.bellee.net`. Then under **Login Portal → Advanced → Reverse Proxy**, route HTTPS `secret-santa.bellee.net:443` → HTTP `127.0.0.1:3080` and assign that certificate.
5. Don't forward the app's 3080/3000 ports or DSM management ports.

`APP_ORIGIN` must exactly match the public HTTPS origin, with **no trailing slash**. The production container refuses HTTP origins and requires at least one configured social provider. Configure both for participants to have both options. The project does not configure your Cloudflare account, router, NAS or provider accounts automatically.

## Backups, membership and deletion

- Back up the `santa-data` volume. For a consistent filesystem backup, stop this app's container first, back up the entire volume, then start it again. With a live SQLite database, do not copy just `santa.sqlite` while omitting its WAL.
- Protect backups like the live database; set a retention policy and communicate it to participants. Test a restore into a separate volume before relying on backups.
- Keep the invite code private and **random** (e.g. `openssl rand -hex 16`), never a guessable phrase. Wrong guesses are limited to 30 per 15 minutes per IP and 10 per hour per signed-in account. Rotating the code prevents new joins with the old code but does **not** remove existing members.
- Short names must be unique within the group (ignoring case, extra spaces and full-width characters) and cannot contain invisible or control characters. Lookalike letters from other alphabets (e.g. Cyrillic "а" vs Latin "a") are not detected.
- A participant can select **My wishlist → Edit name → Delete my account and wishlist**. This permanently deletes their active profile, gift list and every login session. Non-members can delete from the welcome form. Existing backups may retain data until their retention period ends.
- There is no administrator UI. If manual member removal is necessary, stop the app, back up the database, and use SQLite to identify the correct user and delete their sessions and user row inside a transaction. Do not identify someone by short name alone; names can be duplicated.
- Keep DSM, Container Manager and container images patched. Pushing to `main` publishes a fresh image built on the latest Node 24 base. Deploy it with `docker-compose pull && docker-compose up -d`. To roll back, change the `image:` tag in `docker-compose.yaml` to an earlier `sha-…` tag.

## Verification boundaries

Automated tests cover budget boundaries, duplicate/unsafe URLs, preference order, invite access, cross-origin rejection, persistence, logout, account deletion, and OAuth state/session handling using mocked provider responses. Real Google/Meta approval, live sign-in, NAS storage, public DNS and HTTPS must be verified in your actual deployment.
