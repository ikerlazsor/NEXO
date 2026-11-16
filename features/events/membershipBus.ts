type Change = { userId: string; eventId: string; joined: boolean };
const listeners = new Set<(change: Change) => void>();
export function publishEventMembership(change: Change) {
  for (const listener of listeners) listener(change);
}
export function subscribeEventMembership(listener: (change: Change) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
