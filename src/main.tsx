import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { nameSchema, priceToCents, wishlistSchema } from './domain.ts';
import type { CurrentUser, Gift, Member, SessionInfo } from './domain.ts';
import './styles.css';

type Draft = { key: string; url: string; price: string; description: string };
const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const draftGift = (gift?: Gift): Draft => ({
  key: crypto.randomUUID(), url: gift?.url ?? '',
  price: gift ? (gift.priceCents / 100).toFixed(2) : '', description: gift?.description ?? '',
});
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method, credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data: unknown = await response.json();
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error : `Request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function GiftMark({ large = false }: { large?: boolean }) {
  return <svg className={large ? 'gift-mark large' : 'gift-mark'} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M12 30h40v25H12zM8 21h48v10H8z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
    <path d="M32 21v34M32 21C9 21 17 2 26 11l6 10Zm0 0C55 21 47 2 38 11l-6 10Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [tab, setTab] = useState<'mine' | 'group'>('mine');
  const [editName, setEditName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const user = session?.user;

  function applyUser(next: CurrentUser) {
    setSession(previous => previous ? { ...previous, user: next } : previous);
    setName(next.shortName ?? '');
    setDrafts(next.gifts.map(draftGift));
    setDirty(false);
  }
  async function load() {
    const next = await api<SessionInfo>('session');
    setSession(next);
    if (next.user) {
      setName(next.user.shortName ?? '');
      setDrafts(next.user.gifts.map(draftGift));
      setDirty(false);
      if (next.user.member) setMembers((await api<{ members: Member[] }>('members')).members);
    }
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    void perform(async () => {
      await load();
      const authError = new URLSearchParams(location.search).get('authError');
      if (authError) {
        history.replaceState(null, '', '/');
        throw new Error(authError === 'cancelled' ? 'Sign-in was cancelled. You can try again below.' : 'Sign-in failed. Please try again or contact the organiser.');
      }
    });
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function changeDraft(index: number, patch: Partial<Draft>) {
    setDrafts(previous => previous.map((gift, i) => i === index ? { ...gift, ...patch } : gift));
    setDirty(true); setNotice('');
  }
  function move(index: number, direction: number) {
    const next = [...drafts];
    const first = next[index];
    const second = next[index + direction];
    if (!first || !second) return;
    next[index] = second; next[index + direction] = first;
    setDrafts(next); setDirty(true); setNotice('');
  }
  function save() {
    void perform(async () => {
      const parsed = wishlistSchema.safeParse(drafts.map(gift => ({
        url: gift.url, priceCents: priceToCents(gift.price), description: gift.description,
      })));
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Please check your gifts.');
      const result = await api<{ user: CurrentUser }>('wishlist', 'PUT', parsed.data);
      applyUser(result.user);
      setMembers(previous => previous.map(member => member.id === result.user.id ? { ...member, gifts: result.user.gifts } : member));
      setNotice('Your wishlist is saved. A little less guessing for your Santa!');
    });
  }
  function saveProfile(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform(async () => {
      const parsed = nameSchema.safeParse(name);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
      const result = await api<{ user: CurrentUser }>('profile', 'PUT', { shortName: parsed.data, inviteCode: invite });
      setSession(previous => previous ? { ...previous, user: result.user } : previous);
      setName(result.user.shortName ?? '');
      setInvite(''); setEditName(false);
      setMembers((await api<{ members: Member[] }>('members')).members);
      setNotice('You are all set. Time to make a little wishlist.');
    });
  }
  function signOut() {
    if (dirty && !window.confirm('Leave without saving your wishlist changes?')) return;
    void perform(async () => {
      await api('logout', 'POST');
      setSession(previous => previous ? { ...previous, user: null } : previous);
      setMembers([]); setDrafts([]); setInvite(''); setName(''); setDirty(false); setEditName(false);
    });
  }
  function deleteAccount() {
    if (!window.confirm('Permanently delete your profile and wishlist, and sign out on all devices? This cannot be undone.')) return;
    void perform(async () => {
      await api('account', 'DELETE');
      setSession(previous => previous ? { ...previous, user: null } : previous);
      setMembers([]); setDrafts([]); setInvite(''); setName(''); setDirty(false); setEditName(false);
      setNotice('Your profile and wishlist have been deleted. All your sessions have been signed out.');
    });
  }

  return <div className="app-shell">
    <header className="site-header">
      <a className="brand" href="/" aria-label="The Giving List home"><GiftMark /><span>the giving list<span className="brand-sub">SECRET SANTA, SORTED.</span></span></a>
      {user ? <div className="account"><span className="avatar">{(user.shortName ?? '?').slice(0, 1).toUpperCase()}</span><span className="account-name">{user.shortName ?? 'Welcome'}</span><button className="text-button" disabled={busy} onClick={signOut}>Sign out</button></div>
        : <span className="header-note">SMALL WISHES. BIG SMILES.</span>}
    </header>
    <main>
      {error && <div className="message error" role="alert"><span>{error}</span><button className="text-button" disabled={busy} onClick={() => void perform(load)}>Reload</button></div>}
      {notice && <div className="message success" role="status">{notice}</div>}
      {!session ? <section className="loading" aria-live="polite">{busy ? 'Unwrapping something lovely...' : 'Unable to load the website. Use Reload to try again.'}</section>
        : !user ? <>
          <section className="landing">
            <div className="landing-copy"><p className="eyebrow"><span /> A LITTLE CHRISTMAS MAGIC</p>
              <h1>Good gifts start<br />with a <em>little hint.</em></h1>
              <p className="intro">Skip the guessing. Share three things you would love, and make your Secret Santa's day a little easier.</p>
              <div className="sign-in-card"><h2>Your wishlist starts here</h2><p>Sign in, join your group, and let the wishing begin.</p>
                <a className={`social google ${!session.providers.google ? 'disabled' : ''}`} href={session.providers.google ? '/auth/google' : undefined} aria-disabled={!session.providers.google}><span className="google-symbol">G</span>Continue with Google<span aria-hidden="true">→</span></a>
                <a className={`social facebook ${!session.providers.facebook ? 'disabled' : ''}`} href={session.providers.facebook ? '/auth/facebook' : undefined} aria-disabled={!session.providers.facebook}><span className="facebook-symbol">f</span>Continue with Facebook<span aria-hidden="true">→</span></a>
                {(!session.providers.google || !session.providers.facebook) && <p className="setup-note">An unavailable sign-in option still needs to be configured by the organiser.</p>}
                <p className="privacy-note"><LockIcon /> Your wishlist is just for your invite-only group.</p>
              </div>
            </div>
            <div className="illustration" aria-label="An illustrated gift wrapped in green ribbon" role="img">
              <span className="sparkle sparkle-one">✦</span><span className="sparkle sparkle-two">✧</span><span className="sparkle sparkle-three">✧</span>
              <div className="gift-orbit" /><div className="present"><div className="bow bow-left" /><div className="bow bow-right" /><div className="present-lid" /><div className="present-ribbon" /><div className="gift-tag">a little<br /><em>something</em><br />for you</div></div>
              <div className="floating-note"><span className="note-heart">♡</span> Thoughtful beats guesswork.</div>
              <span className="illustration-caption">LESS GUESSING, MORE GIVING</span>
            </div>
          </section>
          <section className="how-it-works"><div><span className="step-number">01</span><h3>Make yourself at home</h3><p>Sign in and join with your group code.</p></div><div><span className="step-number">02</span><h3>Drop a few hints</h3><p>Add up to 3 gifts, each AUD $50 or less.</p></div><div><span className="step-number">03</span><h3>Put your favourite first</h3><p>Rank your wishes. Let Santa do the rest.</p></div></section>
        </> : !user.member || editName ? <section className="onboarding panel">
          <div className="small-gift"><GiftMark large /></div><p className="eyebrow">YOU'RE IN GOOD COMPANY</p>
          <h1>{user.member ? 'A little name change.' : 'Hello, wish maker.'}</h1>
          <p className="muted">{user.member ? 'What should your group call you?' : 'Tell us what your group calls you, then enter your invitation code.'}</p>
          <form onSubmit={saveProfile}>
            <label htmlFor="short-name">Your short name</label><input id="short-name" autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} maxLength={32} required placeholder="e.g. Chris" disabled={busy} />
            {!user.member && <><label htmlFor="invite">Group invitation code</label><input id="invite" type="password" autoComplete="off" value={invite} onChange={event => setInvite(event.target.value)} maxLength={200} required disabled={busy} placeholder="Your organiser has this" /></>}
            <button className="primary full" disabled={busy}>{busy ? 'Saving...' : user.member ? 'Save name' : 'Join the giving list →'}</button>
            {user.member && <button className="text-button full" type="button" onClick={() => { setEditName(false); setName(user.shortName ?? ''); }}>Cancel</button>}
            <button className="remove-button full" type="button" disabled={busy} onClick={deleteAccount}>Delete my account and wishlist</button>
          </form>
        </section> : <section className="dashboard">
          <div className="dashboard-heading"><div><p className="eyebrow">A LITTLE INSPIRATION FOR YOUR SANTA</p><h1>{tab === 'mine' ? <>Your little <em>wishlist.</em></> : <>A group full of <em>good wishes.</em></>}</h1><p className="muted">{tab === 'mine' ? 'Three hints. A $50 limit per gift. Something you would really love.' : 'Find your person, follow their hints, and keep the surprise.'}</p></div><div className="budget-badge"><span>AUD</span><strong>$50</strong><span>MAX PER GIFT</span></div></div>
          <div className="tabs" role="tablist" aria-label="Wishlists">
            <button role="tab" id="mine-tab" aria-controls="mine-panel" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>My wishlist <span>{drafts.length}/3</span></button>
            <button role="tab" id="group-tab" aria-controls="group-panel" aria-selected={tab === 'group'} disabled={busy} onClick={() => void perform(async () => { setMembers((await api<{ members: Member[] }>('members')).members); setTab('group'); })}>Our group <span>{members.length}</span></button>
          </div>
          {tab === 'mine' ? <div role="tabpanel" id="mine-panel" aria-labelledby="mine-tab">
            <div className="list-heading"><p><strong>{user.shortName}'s wishes</strong><span>Number 1 is your most-wanted gift.</span></p><button className="text-button" onClick={() => setEditName(true)}>Edit name</button></div>
            <form onSubmit={event => { event.preventDefault(); save(); }}>
              <div className="gift-list">{drafts.map((gift, index) => <article className="gift-editor panel" key={gift.key}>
                <div className="rank-column"><span className={`rank rank-${index}`}>{index + 1}</span><span className="rank-label">{index === 0 ? 'TOP WISH' : 'NEXT WISH'}</span><div className="rank-controls"><button type="button" title="Move higher" aria-label={`Move gift ${index + 1} higher`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" title="Move lower" aria-label={`Move gift ${index + 1} lower`} disabled={busy || index === drafts.length - 1} onClick={() => move(index, 1)}>↓</button></div></div>
                <fieldset disabled={busy}><legend className="sr-only">Gift {index + 1}</legend>
                  <div className="gift-fields"><div className="url-field"><label htmlFor={`url-${gift.key}`}>Gift link</label><input id={`url-${gift.key}`} type="url" required maxLength={2048} placeholder="https://shop.com/something-lovely" value={gift.url} onChange={event => changeDraft(index, { url: event.target.value })} /></div><div><label htmlFor={`price-${gift.key}`}>Price (AUD)</label><div className="price-input"><span>$</span><input id={`price-${gift.key}`} type="number" step="0.01" min="0.01" max="50" required placeholder="0.00" value={gift.price} onChange={event => changeDraft(index, { price: event.target.value })} /></div></div></div>
                  <label htmlFor={`description-${gift.key}`}>A little detail <span className="optional">(optional)</span></label><textarea id={`description-${gift.key}`} maxLength={300} rows={2} placeholder="A colour, a size, or why this caught your eye..." value={gift.description} onChange={event => changeDraft(index, { description: event.target.value })} />
                  <div className="gift-bottom"><span>{gift.description.length}/300</span><button className="remove-button" type="button" onClick={() => { setDrafts(previous => previous.filter((_, i) => i !== index)); setDirty(true); setNotice(''); }}>Remove gift</button></div>
                </fieldset>
              </article>)}</div>
              {drafts.length < 3 && <button className="add-gift" type="button" disabled={busy} onClick={() => { setDrafts(previous => [...previous, draftGift()]); setDirty(true); setNotice(''); }}><span>+</span><strong>{drafts.length === 0 ? 'Add your first wish' : 'Add another wish'}</strong><span className="muted">{3 - drafts.length} {drafts.length === 2 ? 'spot' : 'spots'} left for something lovely</span></button>}
              <div className="save-bar"><p><LockIcon /> Only your group can see your saved wishes.<br /><span>{dirty ? 'You have unsaved changes.' : 'Changes appear for your group after you save.'}</span></p><button className="primary" type="submit" disabled={busy || !dirty}>{busy ? 'Saving...' : 'Save my wishlist'} <span aria-hidden="true">→</span></button></div>
            </form>
          </div> : <div role="tabpanel" id="group-panel" aria-labelledby="group-tab" className="member-grid">{members.map(member => <article className="panel member-card" key={member.id}>
            <div className="member-title"><span className="avatar">{member.shortName.slice(0, 1).toUpperCase()}</span><h2>{member.shortName}{member.id === user.id && <span className="you-label">YOU</span>}</h2><span className="muted">{member.gifts.length}/3</span></div>
            {member.gifts.length ? <ol className="member-gifts">{member.gifts.map((gift, index) => <li key={gift.url}><span className="mini-rank">{index + 1}</span><div><a href={gift.url} target="_blank" rel="noopener noreferrer">{new URL(gift.url).hostname}<span aria-hidden="true"> ↗</span></a>{gift.description && <p>{gift.description}</p>}<strong className="gift-price">{money.format(gift.priceCents / 100)}</strong></div></li>)}</ol> : <p className="empty-wishes">Still dreaming up their wishlist.<br />Check back for a little inspiration.</p>}
          </article>)}</div>}
          <aside className="gentle-reminder"><span aria-hidden="true">✧</span><div><strong>It's the thought that counts.</strong><p>A wishlist is a little nudge, not a shopping order. The best part is giving.</p></div></aside>
        </section>}
    </main>
    <footer><span className="footer-brand">the giving list</span><span>Made for thoughtful giving. Wrapped in a little joy.</span><a href="/privacy">Privacy</a><a href="/data-deletion">Delete your data</a><span className="footer-star" aria-hidden="true">✦</span></footer>
  </div>;
}

function LockIcon() {
  return <svg className="lock-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" /><path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" /></svg>;
}

createRoot(document.getElementById('root')!).render(<App />);
