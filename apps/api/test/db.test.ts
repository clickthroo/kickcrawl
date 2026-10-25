import { describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';

describe('pool error handling', () => {
  it('has an error listener registered, so an idle client error never becomes an unhandled EventEmitter throw', () => {
    // The actual production bug this guards against: pg.Pool requires a
    // listener on its own 'error' event (emitted on behalf of any idle
    // client that hits a connection-level problem) - without one, Node's
    // EventEmitter treats that event as fatal and throws it uncaught,
    // crashing the entire process. Confirmed as a real outage: a single
    // idle client hit "57P01 terminating connection due to administrator
    // command" and took the whole app down with it.
    expect(pool.listenerCount('error')).toBeGreaterThan(0);
  });

  it('emitting an error on the pool does not throw - the whole point of registering a listener', () => {
    expect(() => pool.emit('error', new Error('simulated idle client error'))).not.toThrow();
  });
});
