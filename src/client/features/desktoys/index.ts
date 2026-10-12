/**
 * The desk toys: the little ones on every agent's desk that show, from across the room, what that
 * agent is up to.
 *
 * Nothing to press: a toy takes no key of its own, so a desk with a toy keeps every key it had. It
 * answers the worker sitting at its desk, which everyone on the floor already has in the store — and
 * when a pull request merges, the office winds up every toy on the floor at once.
 */

import type { Ctx } from '../../core/context';
import type { GongWhy } from '../../../shared/protocol';
import { store } from '../../state';
import { toyMood, windToys } from './world';

/** A merge is worth celebrating; a queue that empties is worth celebrating twice over. */
const CHEER = new Set<GongWhy>(['merged', 'queue']);

/**
 * Keeps every toy's mood current from the floor's workers, and winds the whole floor's toys up when
 * a pull request merges or the queue empties.
 *
 * How long each toy has been wound is the fixture's to wind down and to draw (see deskToys): this
 * only says what each toy is answering, and when to wind them.
 */
export function installDeskToys(ctx: Ctx) {
  ctx.ticks.add('world', () => {
    for (const toy of ctx.office.deskToys.values()) toy.mood = toyMood(store.workerAtDesk(toy.deskId)?.status);
  });

  /** A merge, or the queue emptying: every toy on the floor goes at once. */
  function cheer(why: GongWhy) {
    if (CHEER.has(why)) windToys(ctx.office.deskToys);
  }
  ctx.messages.on('gong', ({ why }) => cheer(why));
  return { cheer };
}