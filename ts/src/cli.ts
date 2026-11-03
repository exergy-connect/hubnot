import { GitHub } from './github';
import { objectTypes, openingFields, type ObjectType, type ObjectInput } from './objects';
import { signObject, type SignedIssue } from './protocol';

export const cliHelp = `Hubnot browser CLI (hn/0 subset)
hn help
hn version
hn <type> list [--json]
hn <type> show <full-event-id-or-unique-prefix> [--json]
hn issue open [--body TEXT] "Title"
hn <resource-type> open --input 'STATE_JSON'
hn retry

Types: ${Object.keys(objectTypes).join(', ')}
Use the repository, token and author name fields above. Public reads need no token.
Resource --input accepts inline native state JSON, not a filesystem path.
Lists/show return original openings, not current revisions. Creation uses a fresh actor.
Supported resources: basic projects, draft project items, discussions, top-level replies,
and disabled workflows. hn retry resumes the exact last uncertain publication.
Other CLI commands, shell execution, pipes, expansion and local files are unavailable.`;

// A small argument lexer, not a shell. Quotes and backslash escaping preserve text.
export function splitCommand(line: string): string[] {
  const args: string[] = [];
  let word = '', quote = '', active = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
      else if (c === '\\' && quote === '"' && ['"', '\\'].includes(line[i + 1])) word += line[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; active = true; }
    else if (c === '\\') {
      if (++i === line.length) throw new Error('Incomplete escape.');
      word += line[i]; active = true;
    } else if (/\s/.test(c)) {
      if (active) { args.push(word); word = ''; active = false; }
    } else {
      if (/[|;&<>`]/.test(c) || (c === '$' && line[i + 1] === '(')) throw new Error('Shell operators are not supported. Quote literal text.');
      word += c; active = true;
    }
  }
  if (quote) throw new Error('Unclosed quote.');
  if (active) args.push(word);
  return args;
}
function resourceInput(type: ObjectType, raw: string): ObjectInput {
  const state = JSON.parse(raw);
  if (!state || Array.isArray(state) || typeof state !== 'object') throw new Error('--input must be an inline JSON object.');
  const input: ObjectInput = { title: state.title ?? state.target?.title ?? '', body: state.body ?? state.description ?? state.target?.body ?? '', category: state.category, workflowName: state.name, parent: state.project_id ?? state.discussion_id, revision: state.project_revision };
  if (typeof input.title !== 'string' || typeof input.body !== 'string') throw new Error('Title and body must be strings.');
  const supported = JSON.parse(openingFields(type, input).body as string);
  const compare = (actual: any, expected: any): boolean => {
    if (actual === null || typeof actual !== 'object') return actual === expected;
    if (!expected || typeof expected !== 'object' || Array.isArray(actual)) return false;
    return Object.keys(actual).every(key => Object.hasOwn(expected, key) && compare(actual[key], expected[key]));
  };
  if (state.schema !== supported.schema || !compare(state, supported)) throw new Error('This state includes unsupported fields or values. See hn help and the object forms for supported creation shapes.');
  return input;
}
export interface CLIContext { repo: string; token: string; author: string }
export class BrowserCLI {
  private pending?: { repo: string; client: GitHub; object: SignedIssue; commit?: string };
  constructor(private clientFor = (repo: string, token: string) => new GitHub(repo, token)) {}
  get hasPending() { return !!this.pending; }
  async run(line: string, context: CLIContext): Promise<string> {
    const args = splitCommand(line);
    if (args.shift() !== 'hn') throw new Error('Commands must start with hn. Try hn help.');
    if (!args.length || (args.length === 1 && ['help', '--help', '-h'].includes(args[0]))) return cliHelp;
    if (args.length === 1 && args[0] === 'version') return 'Hubnot browser PoC 0.1.0 · hn/0 · emulated CLI subset';
    if (args.length === 1 && args[0] === 'retry') return this.publish(context.repo);
    const type = args.shift() as ObjectType;
    if (!Object.hasOwn(objectTypes, type)) throw new Error('Unsupported browser command. Run hn help for available commands; use the native CLI for other operations.');
    if (args.length === 1 && ['help', '--help', '-h'].includes(args[0])) return cliHelp;
    const operation = args.shift();
    const client = this.clientFor(context.repo, context.token);
    if (operation === 'list' || operation === 'show') {
      const json = args.includes('--json');
      const positional = args.filter(arg => arg !== '--json');
      if ((operation === 'list' && positional.length) || (operation === 'show' && positional.length !== 1) || args.filter(a => a === '--json').length > 1) throw new Error(`Usage: hn ${type} ${operation}${operation === 'show' ? ' ID' : ''} [--json]`);
      const objects = await client.listObjects(type);
      if (operation === 'list') return json ? JSON.stringify(objects, null, 2) : objects.map(object => `${object.id}  ${object.title}`).join('\n') || `No ${objectTypes[type].plural} found.`;
      const prefix = positional[0].replace(/^sha256:/, '');
      if (!/^[a-f0-9]{8,64}$/.test(prefix)) throw new Error('Use a full event ID or at least eight hex characters.');
      const matches = objects.filter(object => object.id.slice(7).startsWith(prefix));
      if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous object ID.' : 'Object not found.');
      return JSON.stringify(matches[0], null, 2);
    }
    if (operation !== 'open') throw new Error('Supported browser operations: list, show, open. Run hn help.');
    if (this.pending) throw new Error('An uncertain publication is pending. Run hn retry before creating another object.');
    if (!context.token.trim()) throw new Error('Enter a GitHub token in the repository controls to publish.');
    const flags: Record<string, string> = {};
    const words: string[] = [];
    let positionalOnly = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--') { positionalOnly = true; continue; }
      if (!positionalOnly && args[i].startsWith('-')) {
        const flag = args[i];
        if (!['--body', '--input'].includes(flag) || Object.hasOwn(flags, flag) || i + 1 === args.length) throw new Error(`Unsupported, duplicate or incomplete flag: ${flag}`);
        flags[flag] = args[++i];
      } else words.push(args[i]);
    }
    let input: ObjectInput;
    if (type === 'issue') {
      if (words.length !== 1 || flags['--input'] !== undefined) throw new Error('Usage: hn issue open [--body TEXT] "Title"');
      input = { title: words[0], body: flags['--body'] || '' };
    } else {
      if (words.length || flags['--body'] !== undefined || !flags['--input']) throw new Error(`Usage: hn ${type} open --input 'STATE_JSON'`);
      input = resourceInput(type, flags['--input']);
    }
    const object = await signObject(type, context.author, input);
    const repo = await client.inspect();
    if (repo.permissions?.push === false) throw new Error('This token does not have write access to the selected repository.');
    if (type === 'project-item' || type === 'discussion-reply') {
      const parents = await client.listObjects(type === 'project-item' ? 'project' : 'discussion');
      if (!parents.some(parent => parent.id === input.parent)) throw new Error('Parent opening not found in the selected repository.');
    }
    this.pending = { repo: context.repo, client, object };
    return this.publish(context.repo);
  }
  private async publish(repo: string): Promise<string> {
    const pending = this.pending;
    if (!pending) throw new Error('No publication is pending.');
    if (repo.toLowerCase() !== pending.repo.toLowerCase()) throw new Error(`Select ${pending.repo} before retrying its publication.`);
    try {
      pending.commit ??= await pending.client.prepare(pending.object);
      await pending.client.publish(pending.object, pending.commit);
    } catch (error) {
      throw new Error(`${String(error)}\nPublication may be incomplete. Keep this page open and run hn retry in ${pending.repo}.\nEvent: ${pending.object.id}\nRef: refs/hn/actors/${pending.object.actor}\nCommit: ${pending.commit || 'not yet known'}`);
    }
    this.pending = undefined;
    return `Published ${pending.object.id}\nRepository: ${pending.repo}\nRef: refs/hn/actors/${pending.object.actor}\nCommit: ${pending.commit}`;
  }
}
