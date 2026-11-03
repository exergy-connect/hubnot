import { displayOpening, objectTypes, type ObjectType } from './objects';
import type { SignedIssue } from './protocol';
import { verifyActorEvent, type IssueOpening } from './issues';
export class GitHub {
  constructor(readonly repo: string, private token: string, private transport: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async request<T>(path = '', method = 'GET', data?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await this.transport(`https://api.github.com/repos/${this.repo}${path}`, {
        method, headers: { Accept: 'application/vnd.github+json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(`GitHub ${response.status}: ${error.message || response.statusText}`);
      }
      return await response.json() as T;
    } finally { clearTimeout(timeout); }
  }
  async inspect() {
    const repo = await this.request<{ full_name: string; description: string | null; size: number; permissions?: { push?: boolean } }>();
    // An initialized branch is required by GitHub's create-ref endpoint.
    const branches = await this.request<unknown[]>('/branches?per_page=1');
    if (!branches.length) throw new Error('Initialize this repository with a commit before publishing an issue.');
    return repo;
  }
  async listIssues(): Promise<IssueOpening[]> { return this.listObjects('issue'); }
  async listObjects(type: ObjectType): Promise<IssueOpening[]> {
    return (await this.readActorObjects(type)).objects;
  }
  async summarizeObjects() {
    const { objects, lastChanged, eventCount } = await this.readActorObjects();
    const counts = Object.fromEntries(Object.keys(objectTypes).map(type => [type, 0])) as Record<ObjectType, number>;
    for (const object of objects) counts[object.type!]++;
    return { total: objects.length, counts, lastChanged, eventCount };
  }
  private async readActorObjects(type?: ObjectType) {
    const refs = await this.request<{ ref: string; object: { sha: string; type: string } }[]>('/git/matching-refs/hn/actors/');
    if (!Array.isArray(refs) || refs.length > 100) throw new Error('This PoC supports up to 100 actor histories. Use the CLI for larger repositories.');
    const issues = new Map<string, IssueOpening>();
    let count = 0;
    let lastChanged: string | null = null;
    for (const ref of refs) {
      if (!/^refs\/hn\/actors\/[a-f0-9]{64}$/.test(ref.ref) || ref.object.type !== 'commit') throw new Error('Invalid actor reference.');
      const actor = ref.ref.split('/').at(-1)!;
      let commit: string | undefined = ref.object.sha;
      let expected: { id: string; sequence: number } | undefined;
      const visited = new Set<string>();
      while (commit) {
        if (++count > 300) throw new Error('History exceeds the 300-event browser limit. Use the CLI for larger repositories.');
        if (visited.has(commit)) throw new Error('Cyclic actor history.');
        visited.add(commit);
        const entry: { tree: { sha: string }; parents: { sha: string }[] } = await this.request(`/git/commits/${commit}`);
        if (entry.parents.length > 1) throw new Error('Actor histories must be linear.');
        const tree = await this.request<{ tree: { path: string; sha: string; type: string }[]; truncated?: boolean }>(`/git/trees/${entry.tree.sha}`);
        if (tree.truncated) throw new Error('Truncated actor tree.');
        const read = async (name: string) => {
          const file = tree.tree.find(file => file.path === name && file.type === 'blob');
          if (!file) throw new Error(`Missing ${name} in actor history.`);
          const blob = await this.request<{ content: string; encoding: string; size: number }>(`/git/blobs/${file.sha}`);
          if (blob.encoding !== 'base64' || blob.size > 1048576) throw new Error('Unsupported or oversized event blob.');
          return Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0));
        };
        const payload = await read('event.json');
        const signature = Uint8Array.from(atob(new TextDecoder().decode(await read('signature'))), c => c.charCodeAt(0));
        const { event, id } = await verifyActorEvent(payload, signature, actor);
        if (expected && (id !== expected.id || event.sequence !== expected.sequence)) throw new Error('Broken actor event chain.');
        if (!entry.parents.length && (event.sequence !== 1 || event.previous)) throw new Error('Invalid actor root.');
        if (entry.parents.length && (!event.previous || event.sequence < 2)) throw new Error('Missing event predecessor.');
        if (!lastChanged || Date.parse(event.timestamp) > Date.parse(lastChanged)) lastChanged = event.timestamp;
        const family = event.kind.endsWith('.open') ? event.kind.slice(0, -5) : '';
        if (Object.hasOwn(objectTypes, family) && (!type || family === type)) {
          const openingType = family as ObjectType;
          if (openingType === 'issue' && (typeof event.title !== 'string' || !event.title.trim())) throw new Error('Invalid issue opening.');
          const content = displayOpening(openingType, event.title, event.body);
          issues.set(id, { id, type: openingType, ...content, author: event.actorName, timestamp: event.timestamp });
        }
        expected = { id: event.previous || '', sequence: event.sequence - 1 };
        commit = entry.parents[0]?.sha;
      }
    }
    return { objects: [...issues.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id)), lastChanged, eventCount: count };
  }
  async prepare(issue: SignedIssue): Promise<string> {
    const tree = await this.request<{ sha: string }>('/git/trees', 'POST', { tree: [
      { path: 'event.json', mode: '100644', type: 'blob', content: issue.payload },
      { path: 'signature', mode: '100644', type: 'blob', content: issue.signature },
    ] });
    const commit = await this.request<{ sha: string }>('/git/commits', 'POST', {
      message: `hn event ${issue.id}`, tree: tree.sha, parents: [],
      author: { name: JSON.parse(issue.payload).actorName, email: `${issue.actor.slice(0, 12)}@hn.invalid`, date: JSON.parse(issue.payload).timestamp },
    });
    return commit.sha;
  }
  async publish(issue: SignedIssue, commit: string): Promise<void> {
    const ref = `refs/hn/actors/${issue.actor}`;
    try {
      await this.request('/git/refs', 'POST', { ref, sha: commit });
    } catch (error) {
      // A timed-out create may have succeeded. Reconcile the exact ref, never overwrite it.
      const existing = await this.request<{ object: { sha: string } }>(`/git/ref/hn/actors/${issue.actor}`).catch(() => null);
      if (existing?.object.sha === commit) return;
      throw error;
    }
  }
}
