import { TableTennisBot } from './bot';
import type { TableTennisController } from './controller';
import { PINGPONG_TABLE, PINGPONG_PHYSICS, type BotDifficulty, type PingPongState } from '../../../shared/tabletennis';

/** Only the exhibition operator simulates both bots; other clients follow the shared shots. */
export class TableTennisWatch {
  private bot = new TableTennisBot();
  private difficulty?: BotDifficulty;
  private ended = 0;
  private resetSent = false;
  constructor(private controller: TableTennisController, private reset: () => void) {}
  start(difficulty: BotDifficulty) { this.difficulty = difficulty; this.bot = new TableTennisBot(difficulty); this.bot.reset('west'); this.ended = 0; this.resetSent = false; }
  update(dt: number, state: PingPongState, you: string) {
    const c = this.controller;
    if (!c.active || c.mode !== 'bots') return;
    c.automatesOpponent = state.operatorId === you;
    if (!state.active || state.mode !== 'bots') return;
    if (state.status === 'ended') {
      this.ended += dt;
      if (c.automatesOpponent && this.ended > 3 && !this.resetSent) { this.resetSent = true; this.reset(); }
      return;
    }
    this.ended = 0; this.resetSent = false;
    const difficulty = state.westPlayer?.difficulty ?? 'normal';
    if (difficulty !== this.difficulty) this.start(difficulty);
    if (c.automatesOpponent && c.serving(state)) { c.swing('topspin', 0.5); return; }
    const flight = c.ballInPlay ? { x: c.ballPos.x, y: c.ballPos.y, z: c.ballPos.z, vx: c.ballVel.x, vy: c.ballVel.y, vz: c.ballVel.z, tops: c.ballTops, side: c.ballSide } : null;
    this.bot.look(flight ? c.rally : null, dt);
    const plan = this.bot.plan(flight, 'west', c.oppWhere, c.lastBounceSide === 'west');
    this.bot.step(dt, plan.to); c.automateAt(this.bot.where);
    if (!c.automatesOpponent || !flight || c.lastHitter !== 'east' || c.lastBounceSide !== 'west' || c.swinging || !this.bot.canMeet(flight, plan)) return;
    c.aim = (plan.aim.z - PINGPONG_TABLE.z) / (PINGPONG_TABLE.width / 2 - PINGPONG_PHYSICS.edgeMargin);
    c.depth = plan.depth;
    c.swing(plan.stroke, plan.power);
  }
}
