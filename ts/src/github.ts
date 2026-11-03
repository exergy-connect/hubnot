import type { SignedIssue } from './protocol';
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
