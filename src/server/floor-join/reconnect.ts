import { connectOnce, type ConnectionOptions } from './connection.js';
import { retryConnection } from './retry.js';

/** One process signal handler for the entire retry session, rather than one per socket attempt. */
export async function runFloorHost(url: string, options: ConnectionOptions): Promise<number> {
  const controller = new AbortController();
  const stop = () => {
    console.log('\nfloor-host: closing. The floors here go offline at the office.');
    controller.abort();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const result = await retryConnection(
      authenticated => connectOnce(url, options, controller.signal, authenticated),
      controller.signal,
      { expired: () => console.error('floor-host: office unreachable for 10 minutes; retry window expired.'), log: (ms, remaining) => console.log(`floor-host: reconnecting in ${Math.ceil(ms / 1000)}s (${Math.ceil(remaining / 1000)}s left in the 10-minute retry window)` ) },
    );
    if (result) console.error('floor-host: stopped; reconnect with the saved command after checking the error above.');
    return result;
  } finally {
    process.off('SIGINT', stop); process.off('SIGTERM', stop);
  }
}
