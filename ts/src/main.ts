import './style.css';
import { parseRepo, signObject, type SignedIssue } from './protocol';
import { openingFields, objectTypes, type ObjectType, type ObjectInput } from './objects';
import { GitHub } from './github';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><a href="./" class="brand">h<span>n</span> / hubnot</a><span class="badge">BROWSER LAB · 01</span></header>
  <main><div class="intro"><p class="eyebrow">COLLABORATION, CARRIED BY GIT</p><h1>Your objects.<br>Your signature.</h1><p>Browse native Hubnot objects or create a signed object in a GitHub repository. Signed here in your browser. Stored in Git.</p></div>
  <section aria-label="Hubnot issues"><form id="issue-form">
    <fieldset id="fields"><legend>01 / Choose a repository</legend>
    <label for="repo">GitHub repository</label><div class="row"><input id="repo" name="repo" value="exergy-connect/hubnot" required spellcheck="false" autocapitalize="none" autocorrect="off"><button id="inspect" type="button" class="secondary">Check repo</button></div>
    <label for="token">GitHub access token</label><input id="token" name="token" type="password" autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" placeholder="Optional for public browsing · required to publish">
    <label class="remember"><input id="remember-token" type="checkbox"> Remember token for this repository on this browser</label>
    <p class="hint" id="storage-status" role="status">Optional: saved tokens are stored unencrypted on this browser and accessible to scripts on this site. Uncheck to remove the saved token.</p>
    <p id="repo-status" role="status"></p>
    </fieldset></form>
    <label for="object-type">Hubnot object type</label>
    <select id="object-type">${Object.entries(objectTypes).map(([id, info]) => `<option value="${id}">${info.singular[0].toUpperCase() + info.singular.slice(1)}</option>`).join('')}
    <optgroup label="CLI-only in this PoC"><option disabled>Proposals and reviews</option><option disabled>CI requests and results</option><option disabled>Decisions and merge facts</option><option disabled>Identity relationships</option><option disabled>Memory records</option><option disabled>Audit facts</option><option disabled>Custom artifacts</option></optgroup></select>
    <div class="tabs" role="tablist" aria-label="Issues">
      <button id="existing-tab" type="button" role="tab" aria-selected="false" aria-controls="existing-panel" tabindex="-1">Existing issues</button>
      <button id="new-tab" type="button" role="tab" aria-selected="true" aria-controls="new-panel">New signed issue</button>
    </div>
    <div id="existing-panel" role="tabpanel" aria-labelledby="existing-tab" hidden>
      <p class="hint" id="list-hint">Native issue openings from signed actor histories. Original titles and descriptions are shown; later revisions, status changes and comments are not projected in this PoC.</p>
      <button id="refresh-issues" class="secondary" type="button">Load issues</button>
      <p id="issues-status" role="status" aria-live="polite"></p><div id="issues-list"></div>
    </div>
    <div id="new-panel" role="tabpanel" aria-labelledby="new-tab"><form id="new-issue-form">
    <fieldset id="new-fields"><legend id="write-legend">02 / Write an issue</legend>
    <label for="name">Author name</label><input id="name" name="name" placeholder="Your name" maxlength="200" form="new-issue-form" required>
    <div id="title-field"><label for="title">Title</label><input id="title" name="title" placeholder="What needs to happen?" form="new-issue-form" required></div>
    <label for="body">Description <span class="optional">optional · Markdown text</span></label><textarea id="body" name="body" rows="6" placeholder="Context, expected behavior, and next steps…"></textarea>
    <div id="category-field" hidden><label for="category">Discussion category</label><input id="category" value="general"></div>
    <div id="parent-field" hidden><label id="parent-label" for="parent-id">Parent opening ID</label><input id="parent-id" placeholder="sha256:…" autocapitalize="none" spellcheck="false"></div>
    <div id="revision-field" hidden><label for="project-revision">Project revision ID (use the opening ID)</label><input id="project-revision" placeholder="sha256:…" autocapitalize="none" spellcheck="false"></div>
    <div id="workflow-field" hidden><label for="workflow-name">Workflow name</label><input id="workflow-name" placeholder="check"><p class="hint">Creates a disabled workflow definition. It does not run code.</p></div>
    <p class="hint">This minimal PoC creates a fresh, temporary Ed25519 actor per object. The key is discarded after signing; identity reuse and issue editing are outside this demo.</p>
    </fieldset><button id="submit" type="submit">Sign & publish issue <span aria-hidden="true">↗</span></button>
  </form><p id="status" role="status" aria-live="polite"></p><div id="result" hidden><label for="receipt">Publication receipt</label><textarea id="receipt" readonly rows="7"></textarea><button id="retry" class="secondary" type="button" hidden>Retry this exact publication</button><button id="another" class="secondary" type="button" hidden>Write another issue</button></div></div></section>
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
  element<HTMLFieldSetElement>('new-fields').disabled = locked;
  element<HTMLButtonElement>('submit').disabled = locked;
  element<HTMLSelectElement>('object-type').disabled = locked;
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
    status.textContent = `Published. Your signed ${objectTypes[currentType].singular} is now in the repository’s native Hubnot history.`;
    element<HTMLButtonElement>('another').hidden = false;
    element<HTMLInputElement>('token').value = '';
    pending = undefined;
    element<HTMLSelectElement>('object-type').disabled = false;
  } catch (error) {
    status.textContent = `${String(error)}. Publication may be incomplete. Retry reuses this signed issue and reconciles the exact reference. Keep this page open.`;
    element('result').hidden = false;
    element<HTMLButtonElement>('retry').hidden = false;
  } finally { busy = false; }
}
element<HTMLFormElement>('new-issue-form').onsubmit = async event => {
  event.preventDefault();
  if (busy || pending) return;
  lock(true);
  try {
    status.textContent = 'Checking access and signing locally…';
    if (!value('token').trim()) throw new Error('Enter a GitHub token to publish an issue.');
    const client = new GitHub(parseRepo(value('repo')), value('token').trim());
    const repo = await client.inspect();
    if (repo.permissions?.push === false) throw new Error('This token does not have write access to the selected repository.');
    const draft = readDraft();
    openingFields(currentType, draft);
    if (currentType === 'project-item' || currentType === 'discussion-reply') {
      const parentType = currentType === 'project-item' ? 'project' : 'discussion';
      const parents = await client.listObjects(parentType);
      if (!parents.some(parent => parent.id === draft.parent)) throw new Error(`The selected repository does not contain that ${parentType} opening.`);
    }
    pending = { client, issue: await signObject(currentType, value('name'), draft) };
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

let listGeneration = 0;
function clearIssues() {
  listGeneration++;
  element('issues-list').replaceChildren();
  element('issues-status').textContent = '';
  element<HTMLButtonElement>('refresh-issues').disabled = false;
}
element('repo').addEventListener('input', clearIssues);
tokenInput.addEventListener('input', clearIssues);
async function loadIssues() {
  const generation = ++listGeneration;
  const output = element('issues-status');
  const button = element<HTMLButtonElement>('refresh-issues');
  element('issues-list').replaceChildren();
  output.textContent = 'Loading and verifying actor histories…';
  button.disabled = true;
  try {
    const issues = await new GitHub(parseRepo(value('repo')), value('token').trim()).listObjects(currentType);
    if (generation !== listGeneration) return;
    for (const issue of issues) {
      const card = document.createElement('article');
      card.className = 'issue-card';
      const title = document.createElement('h2'); title.textContent = issue.title;
      const meta = document.createElement('p'); meta.className = 'hint'; meta.textContent = `${issue.author} · ${new Date(issue.timestamp).toLocaleString()}`;
      const body = document.createElement('p'); body.className = 'issue-body'; body.textContent = issue.body;
      const id = document.createElement('code'); id.textContent = issue.id;
      card.append(title, meta, body, id);
      element('issues-list').append(card);
    }
    output.textContent = issues.length ? `${issues.length} signed ${objectTypes[currentType].singular} opening${issues.length === 1 ? '' : 's'}.` : `No native Hubnot ${objectTypes[currentType].plural} found in this repository.`;
  } catch (error) {
    if (generation === listGeneration) output.textContent = String(error);
  } finally {
    if (generation === listGeneration) button.disabled = false;
  }
}
function selectTab(existing: boolean) {
  for (const [id, selected] of [['existing', existing], ['new', !existing]] as const) {
    const tab = element<HTMLButtonElement>(`${id}-tab`);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    element(`${id}-panel`).hidden = !selected;
  }
  if (existing) void loadIssues();
}
element('existing-tab').onclick = () => selectTab(true);
element('new-tab').onclick = () => selectTab(false);
for (const id of ['existing', 'new']) {
  element(`${id}-tab`).onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const existing = event.key === 'Home' || (event.key !== 'End' && id !== 'existing');
      selectTab(existing);
      element(`${existing ? 'existing' : 'new'}-tab`).focus();
    }
  };
}
element('refresh-issues').onclick = loadIssues;

element<HTMLFormElement>('issue-form').onsubmit = event => {
  event.preventDefault();
  element<HTMLButtonElement>('inspect').click();
};

let currentType: ObjectType = 'issue';
const drafts = new Map<ObjectType, ObjectInput>();
function readDraft(): ObjectInput {
  return { title: value('title'), body: value('body'), category: value('category'), parent: value('parent-id'), revision: value('project-revision'), workflowName: value('workflow-name') };
}
element('object-type').onchange = () => {
  drafts.set(currentType, readDraft());
  currentType = value('object-type') as ObjectType;
  lock(false);
  const draft = drafts.get(currentType);
  for (const [id, text] of Object.entries({ title: draft?.title || '', body: draft?.body || '', category: draft?.category || 'general', 'parent-id': draft?.parent || '', 'project-revision': draft?.revision || '', 'workflow-name': draft?.workflowName || '' })) {
    element<HTMLInputElement>(id).value = text;
  }
  const { singular, plural } = objectTypes[currentType];
  element('existing-tab').textContent = `Existing ${plural}`;
  element('new-tab').textContent = `New signed ${singular}`;
  element('refresh-issues').textContent = `Load ${plural}`;
  element('write-legend').textContent = `02 / Create a ${singular}`;
  element('submit').textContent = `Sign & publish ${singular} ↗`;
  element('another').textContent = `Write another ${singular}`;
  element('list-hint').textContent = `Native ${singular} openings from signed actor histories. Original content is shown; later revisions and comments are not projected in this PoC.`;
  element('title-field').hidden = currentType === 'discussion-reply';
  element<HTMLInputElement>('title').required = currentType !== 'discussion-reply';
  element('category-field').hidden = currentType !== 'discussion';
  element('parent-field').hidden = !['project-item', 'discussion-reply'].includes(currentType);
  element('parent-label').textContent = currentType === 'project-item' ? 'Project opening ID' : 'Discussion opening ID';
  element('revision-field').hidden = currentType !== 'project-item';
  element('workflow-field').hidden = currentType !== 'workflow';
  status.textContent = '';
  element('result').hidden = true;
  clearIssues();
  if (!element('existing-panel').hidden) void loadIssues();
};
