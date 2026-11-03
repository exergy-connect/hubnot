import { openingFields, type ObjectType, type ObjectInput } from './objects';
import { ed25519 } from '@noble/curves/ed25519.js';

const utf8 = new TextEncoder();
export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=+$/, '');
export async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), b => b.toString(16).padStart(2, '0')).join('');
}
export interface SignedIssue { id: string; actor: string; payload: string; signature: string }

// Each opening uses its own actor. No shared signing root or chain reconciliation.
export async function signIssue(name: string, title: string, body: string): Promise<SignedIssue> {
  return signObject('issue', name, { title, body });
}
export async function signObject(type: ObjectType, name: string, input: ObjectInput): Promise<SignedIssue> {
  const { title, body } = input;
  if (!name.trim() || /[\r\n\0]/.test(name)) throw new Error('Enter a name without control characters.');
  if (type !== 'discussion-reply' && (!title.trim() || utf8.encode(title).length > 1024)) throw new Error('Title must be 1–1024 UTF-8 bytes.');
  if (utf8.encode(body).length > 65536) throw new Error('Body must be at most 65536 UTF-8 bytes.');
  if (!globalThis.crypto?.subtle) throw new Error('Open this app over HTTPS (or localhost) to sign issues securely.');
  // Bundled Ed25519 also works on mobile browsers without native Ed25519.
  const fields = openingFields(type, input);
  const secret = crypto.getRandomValues(new Uint8Array(32));
  try {
    const publicKey = ed25519.getPublicKey(secret);
    const actor = await digest(publicKey);
    // Plain title/body issue.open is the native protocol's minimal valid issue.
    const event = { protocol: 'hn/0', kind: `${type}.open`, actor, actorName: name,
      publicKey: base64(publicKey), sequence: 1, timestamp: new Date().toISOString(),
      ...fields };
    const payload = JSON.stringify(event);
    const bytes = utf8.encode(payload);
    const signature = ed25519.sign(bytes, secret);
    return { id: `sha256:${await digest(bytes)}`, actor, payload, signature: base64(signature) };
  } finally { secret.fill(0); }
}
export function parseRepo(input: string): string {
  const value = input.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/$/, '').replace(/\.git$/, '');
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?\/[a-z\d_.-]+$/i.test(value) || /\/(?:\.|\.\.)$/.test(value)) {
    throw new Error('Enter owner/repository or an https://github.com/owner/repository URL.');
  }
  return value;
}
