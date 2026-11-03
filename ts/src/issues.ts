import { ed25519 } from '@noble/curves/ed25519.js';
import { digest } from './protocol';

export interface IssueOpening {
  id: string; title: string; body: string; author: string; timestamp: string;
}
export interface ActorEvent {
  protocol: string; kind: string; actor: string; actorName: string;
  publicKey: string; sequence: number; timestamp: string; previous?: string;
  title?: string; body?: string;
}
export async function verifyActorEvent(payload: Uint8Array, signature: Uint8Array, actor: string) {
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as ActorEvent;
  const key = Uint8Array.from(atob(event.publicKey), c => c.charCodeAt(0));
  if (event.protocol !== 'hn/0' || event.actor !== actor || await digest(key) !== actor ||
      !Number.isSafeInteger(event.sequence) || event.sequence < 1 ||
      typeof event.actorName !== 'string' || !Number.isFinite(Date.parse(event.timestamp)) ||
      !ed25519.verify(signature, payload, key, { zip215: false })) {
    throw new Error('Invalid actor event or signature.');
  }
  return { event, id: `sha256:${await digest(payload)}` };
}
