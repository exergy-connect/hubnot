import './style.css';
import { parseRepo, signIssue, type SignedIssue } from './protocol';
import { GitHub } from './github';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><a href="./" class="brand">h<span>n</span> / hubnot</a><span class="badge">BROWSER LAB · 01</span></header>
  <main><div class="intro"><p class="eyebrow">COLLABORATION, CARRIED BY GIT</p><h1>An issue.<br>Your signature.</h1><p>Create a native Hubnot issue in any GitHub repository you can write to. Signed here in your browser. Stored in Git.</p></div>
  <section aria-label="Create issue"><form id="issue-form">
    <fieldset id="fields"><legend>01 / Choose a repository</legend>
    <label for="repo">GitHub repository</label><div class="row"><input id="repo" name="repo" value="exergy-connect/hubnot" required spellcheck="false" autocapitalize="none" autocorrect="off"><button id="inspect" type="button" class="secondary">Check repo</button></div>
    <label for="token">GitHub access token</label><input id="token" name="token" type="password" autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" placeholder="Fine-grained token · Contents: read and write" required>
    <label class="remember"><input id="remember-token" type="checkbox"> Remember token for this repository on this browser</label>
    <p class="hint" id="storage-status" role="status">Optional: saved tokens are stored unencrypted on this browser and accessible to scripts on this site. Uncheck to remove the saved token.</p>
    <p id="repo-status" role="status"></p>
    <div class="divider">02 / Write an issue</div>
    <label for="name">Author name</label><input id="name" name="name" placeholder="Your name" maxlength="200" required>
    <label for="title">Title</label><input id="title" name="title" placeholder="What needs to happen?" required>
    <label for="body">Description <span class="optional">optional · Markdown text</span></label><textarea id="body" name="body" rows="6" placeholder="Context, expected behavior, and next steps…"></textarea>
    <p class="hint">This minimal PoC creates a fresh, temporary Ed25519 actor per issue. The key is discarded after signing; identity reuse and issue editing are outside this demo.</p>
    </fieldset><button id="submit" type="submit">Sign & publish issue <span aria-hidden="true">↗</span></button>
  </form><p id="status" role="status" aria-live="polite"></p><div id="result" hidden><label for="receipt">Publication receipt</label><textarea id="receipt" readonly rows="7"></textarea><button id="retry" class="secondary" type="button" hidden>Retry this exact publication</button><button id="another" class="secondary" type="button" hidden>Write another issue</button></div></section>
  <footer>hn/0 protocol <span>Browser → Ed25519 → GitHub Git objects → refs/hn/actors/*</span></footer></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => element<HTMLInputElement>(id).value;
const status = element<HTMLParagraphElement>('status');
let pending: { client: GitHub; issue: SignedIssue; commit?: string } | undefined;
let busy = false;
const tokenInput = element<HTMLInputElement>('token');
const rememberToken = element<HTMLInputElement>('remember-token');
let tokenRepo: string | undefined;
function selectedRepo() {
  try { return parseRepo(value('repo')).toLowerCase(); } catch { return undefined; }
}
function storageKey(repo: string) { return `hubnot:github-token:${repo}`; }
function storageFailed() {
  rememberToken.checked = false;
  element('storage-status').textContent = 'Browser storage is unavailable. The token will only be used in memory.';
}
function restoreToken() {
  tokenRepo = selectedRepo();
  tokenInput.value = '';
  rememberToken.checked = false;
  if (!tokenRepo) return;
  try {
    const saved = localStorage.getItem(storageKey(tokenRepo));
    if (saved) { tokenInput.value = saved; rememberToken.checked = true; }
  } catch { storageFailed(); }
}
function saveTokenPreference() {
  const repo = selectedRepo();
  if (!repo) { rememberToken.checked = false; return; }
  try {
    if (rememberToken.checked && tokenInput.value.trim()) {
      localStorage.setItem(storageKey(repo), tokenInput.value.trim());
    } else {
      localStorage.removeItem(storageKey(repo));
    }
  } catch { storageFailed(); }
}
element('repo').addEventListener('input', () => {
  if (selectedRepo() !== tokenRepo) restoreToken();
});
rememberToken.addEventListener('change', saveTokenPreference);
tokenInput.addEventListener('input', saveTokenPreference);
restoreToken();

function lock(locked: boolean) {
  element<HTMLFieldSetElement>('fields').disabled = locked;
  element<HTMLButtonElement>('submit').disabled = locked;
}
element('inspect').onclick = async () => {
  const output = element('repo-status');
  const button = element<HTMLButtonElement>('inspect');
  button.disabled = true;
  output.textContent = 'Checking repository…';
  try {
    const repo = await new GitHub(parseRepo(value('repo')), value('token').trim()).inspect();
    output.textContent = `${repo.full_name} · ${repo.permissions?.push ? 'Write access available' : 'Token with Contents write access required'}${repo.description ? ` · ${repo.description}` : ''}`;
  } catch (error) { output.textContent = String(error); }
  finally { button.disabled = false; }
};
async function publish() {
  if (!pending || busy) return;
  busy = true;
  element<HTMLButtonElement>('retry').hidden = true;
  try {
    status.textContent = 'Uploading signed Git objects…';
    pending.commit ??= await pending.client.prepare(pending.issue);
    // Keep the commit in memory and show it before the ref write for recovery.
    element('result').hidden = false;
    element<HTMLTextAreaElement>('receipt').value = JSON.stringify({ repository: pending.client.repo, eventId: pending.issue.id,
      ref: `refs/hn/actors/${pending.issue.actor}`, commit: pending.commit }, null, 2);
    status.textContent = 'Publishing actor reference…';
    await pending.client.publish(pending.issue, pending.commit);
    status.textContent = 'Published. Your signed issue is now in the repository’s native Hubnot history.';
    element<HTMLButtonElement>('another').hidden = false;
    element<HTMLInputElement>('token').value = '';
    pending = undefined;
  } catch (error) {
    status.textContent = `${String(error)}. Publication may be incomplete. Retry reuses this signed issue and reconciles the exact reference. Keep this page open.`;
    element('result').hidden = false;
    element<HTMLButtonElement>('retry').hidden = false;
  } finally { busy = false; }
}
element<HTMLFormElement>('issue-form').onsubmit = async event => {
  event.preventDefault();
  if (busy || pending) return;
  lock(true);
  try {
    status.textContent = 'Checking access and signing locally…';
    const client = new GitHub(parseRepo(value('repo')), value('token').trim());
    const repo = await client.inspect();
    if (repo.permissions?.push === false) throw new Error('This token does not have write access to the selected repository.');
    pending = { client, issue: await signIssue(value('name'), value('title'), value('body')) };
    await publish();
  } catch (error) { status.textContent = String(error); lock(false); }
};
element('retry').onclick = publish;
element('another').onclick = () => {
  element('result').hidden = true;
  element('another').hidden = true;
  element<HTMLInputElement>('title').value = '';
  element<HTMLTextAreaElement>('body').value = '';
  status.textContent = '';
  restoreToken();
  lock(false);
};
