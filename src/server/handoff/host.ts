import type { Floor } from '../floor.js';
import { handoffs } from './service.js';
export const handoffHostCalls: Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> = { 'handoff.list': (floor: Floor) => ({ handoffs: handoffs(floor).list() }) };
