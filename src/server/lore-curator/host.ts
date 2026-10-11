import type { Floor } from '../floor.js';
import type { ServerMsg } from '../../shared/protocol.js';
export const curatorHostSnapshot = (floor: Floor): ServerMsg => ({ t: 'curator.state', floor: floor.id, state: floor.curator.state() });
export const curatorHostCalls: Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> = {
  'curator.get': floor => floor.curator.state(),
  'curator.configure': (floor, msg) => floor.curator.configure(msg.settings),
  'curator.pause': (floor, msg) => floor.curator.pause(msg.paused),
  'curator.run': floor => floor.curator.start(),
  'curator.restore': (floor, msg) => floor.curator.restore(String(msg.id), msg.revision as number | undefined),
  'curator.history': (floor, msg) => floor.curator.history(String(msg.id)),
};
