// Served as complete HTML (no JavaScript) so Meta's and Google's URL checkers can read them.
const styles = `
*{box-sizing:border-box}body{margin:0;font-family:"DM Sans",system-ui,sans-serif;color:#263e36;background:#faf9f5;line-height:1.55}
.shell{max-width:1280px;margin:auto;padding:0 64px}header{height:113px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e4e6dc;gap:20px}
.brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none;font-family:"Playfair Display",Georgia,serif;font-size:26px;font-weight:600;letter-spacing:-.7px}
.brand svg{width:43px;height:43px;color:#204d40}.back{color:#6c7b66;font-size:15px;text-underline-offset:3px}
article{max-width:740px;margin:60px auto 80px}.eyebrow{font-size:13px;font-weight:650;letter-spacing:2px;margin:0 0 23px}
h1{font-family:"Playfair Display",Georgia,serif;font-size:44px;font-weight:500;line-height:1.15;letter-spacing:-1.5px;margin:0 0 32px}
h2{font-family:"Playfair Display",Georgia,serif;font-size:24px;font-weight:500;margin:27px 0 12px}
p{font-size:16px;line-height:1.9;color:#71796b;margin:0 0 15px}a{color:inherit}
@media(max-width:700px){.shell{padding:0 22px}header{height:90px}.brand{font-size:22px}h1{font-size:34px}article{margin:36px auto 60px}}`;

const giftMark = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M12 30h40v25H12zM8 21h48v10H8z" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M32 21v34M32 21C9 21 17 2 26 11l6 10Zm0 0C55 21 47 2 38 11l-6 10Z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const privacy = `
<h2>What this site stores</h2><p>This private gift group stores your Google or Facebook account's provider identifier, your chosen short name, group membership and up to three gift links, prices and descriptions. It does not store your social password, email address, contacts or advertising identifiers. Social access tokens are used during sign-in and are not saved.</p>
<h2>Who can see your wishes</h2><p>Signed-in members who know the group invitation code can view all members' short names and saved wishlists. The NAS operator can access the database. Do not put sensitive personal information in gift descriptions.</p>
<h2>Cookies and storage</h2><p>A necessary, secure, HttpOnly cookie remembers your login for up to 30 days. A separate sign-in verification cookie expires after 10 minutes. Your actual profile and wishlist are stored in SQLite on the organiser's NAS, not in the cookie. There are no advertising or analytics cookies.</p>
<h2>Other services</h2><p>Google or Facebook handles your sign-in under its own privacy policy. Gift retailers receive your visit when you open their links. This site does not fetch gift pages or automatically check prices; prices are entered by members.</p>
<h2>Retention and your choices</h2><p>Profiles and wishlists remain until you or the organiser deletes them. Expired login sessions and sign-in records are periodically removed. You can <a href="/data-deletion">delete your account and wishlist</a> at any time. For questions or backup retention details, contact the organiser through your group invitation channel.</p>`;

const deletion = `
<h2>Remove your profile and wishlist</h2><p>Sign in using the same Google or Facebook account you used to join. On My wishlist, select Edit name, then Delete my account and wishlist, and confirm. If you have not joined the group yet, the delete button is on the welcome form.</p>
<p>This immediately removes your stored provider identifier, short name, group membership, gifts and login sessions from the active database. You will be signed out on all devices. Signing in again creates a new, empty profile.</p>
<h2>If you cannot sign in</h2><p>Contact the organiser through the channel where you received the invitation code. They can help verify your account and arrange deletion. Backup copies, if kept by the organiser, are removed according to their backup retention schedule; ask the organiser for that schedule.</p>
<h2>Disconnect your social account</h2><p>You can also revoke access in your Google account's third-party connections or Facebook's Apps and websites settings. Revoking access there does not delete this site's existing wishlist; use the steps above too.</p>`;

export function infoPage(kind: 'privacy' | 'deletion'): string {
  const title = kind === 'privacy' ? 'Privacy policy' : 'Delete your data';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | The Giving List</title><meta name="description" content="${title} for The Giving List, a private Secret Santa wishlist.">
<style>${styles}</style></head>
<body><div class="shell"><header><a class="brand" href="/">${giftMark}<span>the giving list</span></a><a class="back" href="/">Back to wishlists</a></header>
<main><article><p class="eyebrow">YOUR PRIVACY MATTERS</p><h1>${kind === 'privacy' ? 'A little privacy.' : 'Delete your data.'}</h1>${kind === 'privacy' ? privacy : deletion}</article></main></div></body></html>`;
}
