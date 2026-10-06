import { communications } from '../../office/communications.js';
import type { ViewPieces } from './types.js';

export const communicationsView: ViewPieces['communications'] = (ctx, floor) => {
  if (!floor) return { messages: [] };
  try { return communications(ctx, floor).state(); }
  catch (err) { return { messages: [], error: `Communications unavailable: ${(err as Error).message}` }; }
};
