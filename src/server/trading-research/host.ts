import type { Floor } from '../floor.js';
import type { ResearchAction } from '../../shared/trading-research.js';
import { localResearch } from './link.js';
export const researchHostCalls: Record<string, (floor: Floor, msg: Record<string, unknown>) => unknown> = {
  'research.get': floor => localResearch(floor).view(),
  'research.configure': (floor, msg) => localResearch(floor).configure(msg as unknown as { enabled: boolean; url: string; token?: string }),
  'research.action': (floor, msg) => localResearch(floor).action(msg.body as ResearchAction),
  'research.dispatch': (floor, msg) => localResearch(floor).dispatch(String(msg.assignment), String(msg.worker), String(msg.by)),
};
