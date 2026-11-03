export const objectTypes = {
  issue: { singular: 'issue', plural: 'issues' },
  project: { singular: 'project', plural: 'projects' },
  'project-item': { singular: 'project item', plural: 'project items' },
  discussion: { singular: 'discussion', plural: 'discussions' },
  'discussion-reply': { singular: 'discussion reply', plural: 'discussion replies' },
  workflow: { singular: 'workflow', plural: 'workflows' },
} as const;
export type ObjectType = keyof typeof objectTypes;
export interface ObjectInput { title: string; body: string; category?: string; parent?: string; revision?: string; workflowName?: string }
const fullID = /^sha256:[a-f0-9]{64}$/;
export function openingFields(type: ObjectType, input: ObjectInput): Record<string, unknown> {
  const { title, body } = input;
  if (type === 'issue') return { title, ...(body ? { body } : {}) };
  let state: Record<string, unknown>;
  switch (type) {
    case 'project': state = { schema: 'hn.project/1', title, body, archived: false }; break;
    case 'discussion':
      if (!input.category?.trim() || new TextEncoder().encode(input.category).length > 256 || /[\x00-\x1f\x7f]/.test(input.category)) throw new Error('Enter a discussion category of 1–256 bytes without control characters.');
      state = { schema: 'hn.discussion/1', title, body, category: input.category, status: 'open' }; break;
    case 'workflow':
      if (!input.workflowName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.workflowName) || input.workflowName.length > 64) throw new Error('Enter a valid workflow name (letters, digits, dots, underscores, hyphens).');
      state = { schema: 'hn.workflow/1', name: input.workflowName, title, description: body, enabled: false }; break;
    case 'project-item':
      if (!fullID.test(input.parent || '') || !fullID.test(input.revision || '') || input.parent !== input.revision) throw new Error('Enter the same full project opening ID in both fields. This PoC creates draft items against the opening schema.');
      state = { schema: 'hn.project-item/1', project_id: input.parent, project_revision: input.revision,
        target: { kind: 'draft', title, body }, archived: false, position: '0' }; break;
    case 'discussion-reply':
      if (!fullID.test(input.parent || '') || !body.trim()) throw new Error('A reply requires a full discussion opening ID and a nonempty body.');
      state = { schema: 'hn.discussion-reply/1', discussion_id: input.parent, body }; break;
  }
  return { body: JSON.stringify(state), intent: 'open' };
}
export function displayOpening(type: ObjectType, title?: string, body?: string) {
  if (type === 'issue') return { title: title || '', body: body || '' };
  const state = JSON.parse(body || '{}') as Record<string, unknown>;
  if (state.schema !== `hn.${type}/1`) throw new Error('Invalid object state schema.');
  return {
    title: String(state.title || (state.target as { title?: string } | undefined)?.title || (type === 'discussion-reply' ? `Reply to ${state.discussion_id}` : type)),
    body: String(state.body || state.description || (state.target as { body?: string } | undefined)?.body || ''),
  };
}
