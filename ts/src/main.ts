import './style.css';
import { BrowserCLI } from './cli';
import { parseRepo, signObject, type SignedIssue } from './protocol';
import { openingFields, objectTypes, type ObjectType, type ObjectInput } from './objects';
import { GitHub } from './github';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="repo-toolbar" aria-label="Repository connection"><a href="./" class="brand">h<span>n</span> / hubnot</a><form id="issue-form">
    <fieldset id="fields"><legend class="visually-hidden">Repository connection</legend>
    <div class="repo-control"><label for="repo">GitHub repository</label><div class="row"><input id="repo" name="repo" value="exergy-connect/hubnot" required spellcheck="false" autocapitalize="none" autocorrect="off"><button id="inspect" type="button" class="secondary">Check repo</button></div></div>
    <div class="token-control"><label for="token">GitHub access token</label><input id="token" name="token" type="password" autocomplete="off" spellcheck="false" autocapitalize="none" autocorrect="off" placeholder="Optional token"><label class="remember" title="Save this token for this repository in this browser. Stored unencrypted and accessible to scripts on this site. Uncheck to remove it."><input id="remember-token" type="checkbox" aria-label="Keep token for this repository" aria-describedby="keep-help"> keep</label></div>
    <span id="keep-help" class="visually-hidden">Save this token for this repository in this browser. Stored unencrypted and accessible to scripts on this site. Uncheck to remove it.</span>
    <p class="hint" id="storage-status" role="status"></p>
    <p id="repo-status" role="status"></p>
    </fieldset></form></header>
  <main><div class="intro"><h1>PERMISSIONLESS COLLABORATION.</h1><p class="promise">No installation. No accounts. No gatekeepers.</p><p class="ownership">Your objects. Your signature. Your repository.</p><p class="intro-description">Explore native Hubnot objects or create and cryptographically sign your own — entirely in your browser.</p></div>
  <section class="workspace" aria-label="Hubnot issues"><aside class="object-picker">
    <fieldset id="object-type"><legend>Hubnot object type</legend><div class="object-type-options">${Object.entries(objectTypes).map(([id, info]) => `<label><input type="radio" name="object-type" value="${id}" ${id === 'issue' ? 'checked' : ''}><span>${info.singular[0].toUpperCase() + info.singular.slice(1)}</span></label>`).join('')}</div></fieldset>
    <p class="hint type-limit">Other object families are available through the native CLI.</p>
    </aside><div class="object-workspace"><div class="tabs" role="tablist" aria-label="Issues">
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
    <label for="body">Description <span class="optional">optional · Markdown text</span></label><textarea id="body" name="body" rows="3" placeholder="Context, expected behavior, and next steps…"></textarea>
    <div id="category-field" hidden><label for="category">Discussion category</label><input id="category" value="general"></div>
    <div id="parent-field" hidden><label id="parent-label" for="parent-id">Parent opening ID</label><input id="parent-id" placeholder="sha256:…" autocapitalize="none" spellcheck="false"></div>
    <div id="revision-field" hidden><label for="project-revision">Project revision ID (use the opening ID)</label><input id="project-revision" placeholder="sha256:…" autocapitalize="none" spellcheck="false"></div>
    <div id="workflow-field" hidden><label for="workflow-name">Workflow name</label><input id="workflow-name" placeholder="check"><p class="hint">Creates a disabled workflow definition. It does not run code.</p></div>
    <p class="hint">This minimal PoC creates a fresh, temporary Ed25519 actor per object. The key is discarded after signing; identity reuse and issue editing are outside this demo.</p>
    </fieldset><div class="creation-actions"><button id="download" type="submit" value="download">Sign & download</button><button id="submit" type="submit">Sign & publish issue <span aria-hidden="true">↗</span></button></div><p class="hint">Sign & download needs no account or token. Direct GitHub publishing requires repository write access.</p>
  </form><p id="status" role="status" aria-live="polite"></p><div id="result" hidden><label for="receipt">Publication receipt</label><textarea id="receipt" readonly rows="3"></textarea><button id="retry" class="secondary" type="button" hidden>Retry this exact publication</button><button id="another" class="secondary" type="button" hidden>Write another issue</button></div></div></div></section>
  <section class="console" aria-label="Hubnot CLI console">
    <details><summary>Hubnot CLI console <span class="console-toggle">click to open</span></summary>
    <p class="hint">Uses the selected repository and token. Browser emulation of supported hn commands; type hn help for the command list. Output and history stay in memory.</p>
    <label for="cli-author">Console author name (for signed creations)</label><input id="cli-author" value="Browser user" maxlength="200">
    <pre id="cli-output" role="log" aria-live="polite" aria-label="Console output">Type hn help to get started.</pre>
    <form id="cli-form"><label for="cli-input">Command</label><div class="row"><input id="cli-input" placeholder='hn issue list' autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" required><button id="cli-run" type="submit">Run</button><button id="cli-clear" type="button" class="secondary">Clear</button></div></form>
    </details>
  </section>
  <footer>Signed locally. Stored in Git. Shared without permission.<span>hn/0 · Your key is your signature.</span></footer></main>`;
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => element<HTMLInputElement>(id).value;
const status = element<HTMLParagraphElement>('status');
let pending: { client: GitHub; issue: SignedIssue; commit?: string } | undefined;
let busy = false;
let formPreparing = false;
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
  element<HTMLButtonElement>('download').disabled = locked;
  element<HTMLFieldSetElement>('object-type').disabled = locked;
}
let repoCheckGeneration = 0;
for (const id of ['repo', 'token']) element(id).addEventListener('input', () => {
  repoCheckGeneration++;
  element('repo-status').textContent = '';
  element<HTMLButtonElement>('inspect').disabled = false;
});
element('inspect').onclick = async () => {
  const generation = ++repoCheckGeneration;
  const output = element('repo-status');
  const button = element<HTMLButtonElement>('inspect');
  button.disabled = true;
  output.textContent = 'Checking repository…';
  try {
    const client = new GitHub(parseRepo(value('repo')), value('token').trim());
    const repo = await client.inspect();
    if (generation !== repoCheckGeneration) return;
    output.textContent = 'Verifying Hubnot histories and counting objects…';
    const summary = await client.summarizeObjects();
    if (generation !== repoCheckGeneration) return;
    const breakdown = Object.entries(summary.counts).filter(([, count]) => count > 0).map(([type, count]) => `${count} ${count === 1 ? objectTypes[type as ObjectType].singular : objectTypes[type as ObjectType].plural}`).join(', ');
    const latest = summary.lastChanged ? new Date(summary.lastChanged).toLocaleString() : 'none';
    output.textContent = `${repo.full_name} · ${summary.total ? `${summary.total} supported Hubnot object${summary.total === 1 ? '' : 's'} (${breakdown})` : 'No supported Hubnot objects found'} · Latest signed event: ${latest} · ${summary.eventCount} verified event${summary.eventCount === 1 ? '' : 's'} · ${repo.permissions?.push ? 'Write access available' : 'Read access; publishing needs a token with Contents write access'}. Counts cover original openings; dates are signer-reported.`;
  } catch (error) { if (generation === repoCheckGeneration) output.textContent = `Repository check failed: ${String(error)}`; }
  finally { if (generation === repoCheckGeneration) button.disabled = false; }
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
    element<HTMLFieldSetElement>('object-type').disabled = false;
  } catch (error) {
    status.textContent = `${String(error)}. Publication may be incomplete. Retry reuses this signed issue and reconciles the exact reference. Keep this page open.`;
    element('result').hidden = false;
    element<HTMLButtonElement>('retry').hidden = false;
  } finally { busy = false; }
}
element<HTMLFormElement>('new-issue-form').onsubmit = async event => {
  event.preventDefault();
  if (busy || pending || cliRunning || formPreparing) return;
  if (cli.hasPending) { status.textContent = 'Run hn retry in the console to resolve its pending publication first.'; return; }
  formPreparing = true;
  lock(true);
  try {
    if ((event as SubmitEvent).submitter?.id === 'download') {
      const repositoryHint = parseRepo(value('repo'));
      const object = await signObject(currentType, value('name'), readDraft());
      const packet = { format: 'hubnot.browser-signed-object/1', repositoryHint, ...object };
      const url = URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `hubnot-${currentType}-${object.id.slice(7, 19)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = 'Signed locally and downloaded. Share this signed object file through any channel; no GitHub write was made.';
      lock(false);
      return;
    }
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
  finally { formPreparing = false; }
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
      const verificationText = 'Verified: Ed25519 signature over the exact event bytes; SHA-256 event ID and public-key fingerprint matching the actor; hn/0 protocol, positive sequence and parseable timestamp; linear actor ancestry with matching predecessor hashes and sequence continuity. This is not full schema, dependency or policy-admission validation, and does not establish the author’s real-world identity.';
      const verified = document.createElement('button');
      verified.type = 'button'; verified.className = 'verification-tick'; verified.textContent = '✓';
      verified.title = verificationText;
      verified.setAttribute('aria-label', 'Signature and actor chain verified. Show verification details.');
      verified.setAttribute('aria-expanded', 'false');
      const explanation = document.createElement('p');
      explanation.className = 'hint verification-details'; explanation.hidden = true;
      explanation.id = `verification-${issue.id.slice(7)}`; explanation.textContent = verificationText;
      verified.setAttribute('aria-controls', explanation.id);
      verified.onclick = () => { explanation.hidden = !explanation.hidden; verified.setAttribute('aria-expanded', String(!explanation.hidden)); };
      const identity = document.createElement('div'); identity.className = 'object-identity';
      identity.append(id, verified);
      card.append(title, meta, body, identity, explanation);
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
  currentType = element<HTMLFieldSetElement>('object-type').querySelector<HTMLInputElement>('input:checked')!.value as ObjectType;
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

const cli = new BrowserCLI();
let cliRunning = false;
const cliHistory: string[] = [];
let cliHistoryIndex = 0;
let cliDraft = '';
const cliInput = element<HTMLInputElement>('cli-input');
const cliOutput = element<HTMLPreElement>('cli-output');
function appendConsole(text: string) {
  cliOutput.textContent = `${cliOutput.textContent}\n${text}`.slice(-100000);
  cliOutput.scrollTop = cliOutput.scrollHeight;
}
element<HTMLFormElement>('cli-form').onsubmit = async event => {
  event.preventDefault();
  if (cliRunning) return;
  if (busy || pending || formPreparing) { appendConsole('Error: Finish or retry the form publication before using the console.'); return; }
  const line = cliInput.value.trim();
  if (!line) return;
  cliHistory.push(line);
  if (cliHistory.length > 100) cliHistory.shift();
  cliHistoryIndex = cliHistory.length;
  cliDraft = '';
  cliInput.value = '';
  let repo: string;
  try { repo = parseRepo(value('repo')); } catch (error) { appendConsole(String(error)); return; }
  appendConsole(`\n${repo} $ ${line}`);
  const wasLocked = element<HTMLFieldSetElement>('fields').disabled;
  cliRunning = true;
  lock(true);
  element<HTMLButtonElement>('cli-run').disabled = true;
  try {
    const output = await cli.run(line, { repo, token: value('token').trim(), author: value('cli-author') });
    appendConsole(output);
    if (output.startsWith('Published ')) clearIssues();
  } catch (error) { appendConsole(`Error: ${String(error)}`); }
  finally {
    cliRunning = false;
    lock(wasLocked);
    element<HTMLButtonElement>('cli-run').disabled = false;
    cliInput.focus();
  }
};
element('cli-clear').onclick = () => { cliOutput.textContent = ''; };
cliInput.onkeydown = event => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  if (cliHistoryIndex === cliHistory.length) cliDraft = cliInput.value;
  cliHistoryIndex = Math.max(0, Math.min(cliHistory.length, cliHistoryIndex + (event.key === 'ArrowUp' ? -1 : 1)));
  cliInput.value = cliHistoryIndex === cliHistory.length ? cliDraft : cliHistory[cliHistoryIndex];
};
