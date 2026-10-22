import path from 'node:path';
import { list } from '../meeting-output.js';
import type { Meeting } from '../../shared/protocol.js';
import { slugify } from '../../shared/meetings.js';
import type { PromptId, PromptVars } from '../../shared/prompts.js';
import type { PatternPart } from './types.js';

/** Compatibility adapter: keep the original five workflows and prompt IDs unchanged. */
export function legacyPlan(m: Meeting, round: number, step: number, cwd: string,
  say: (id: PromptId, vars?: PromptVars) => string): PatternPart[] | null {

    const n = m.seats.length;
    // Parts name their files by full path: a worktree sits inside the project's own folder, and an
    // agent can take a relative path to be the project's (and then it's asked about writing outside).
    const A = (rel: string) => path.join(cwd, rel);
    const note = (r: number, i: number) => `${m.notes}/r${r}-${i + 1}-${slugify(m.seats[i].role, 24)}.md`;
    const notes = (r: number, seats: number[]) => seats.map((i) => A(note(r, i))).join(', ');
    const all = m.seats.map((_, i) => i);
    const last = round >= m.rounds || m.lastRound === round;
    switch (m.pattern) {
      case 'debate': {
        if (step > 1) return null;
        if (last) {
          return [{ seat: 0, doing: 'writing the decision', file: m.output, ask: say('meeting.debate.decide', { notes: A(m.notes), lastNotes: notes(round - 1, all), output: A(m.output) }) }];
        }
        if (round === 1) return all.map((i) => ({ seat: i, doing: 'proposing', file: note(1, i), ask: say('meeting.debate.propose', { role: m.seats[i].role, file: A(note(1, i)) }) }));
        return all.map((i) => ({
          seat: i,
          doing: 'critiquing',
          file: note(round, i),
          ask: say('meeting.debate.critique', { previousRound: round - 1, theirNotes: notes(round - 1, all.filter((j) => j !== i)), file: A(note(round, i)) }),
        }));
      }
      case 'lead': {
        const team = all.slice(1);
        if (step > 1) return null;
        const plan = `${m.notes}/plan.md`;
        if (round === 1) {
          const parts = `${team.length} part${team.length === 1 ? '' : 's'}`;
          return [{ seat: 0, doing: 'planning', file: plan, ask: say('meeting.lead.plan', { parts, team: list(team.map((i) => `the ${m.seats[i].role}`)), exampleRole: m.seats[team[0]].role, file: A(plan) }) }];
        }
        if (round === 2) {
          return team.map((i) => ({ seat: i, doing: 'doing their part', file: note(2, i), ask: say('meeting.lead.part', { plan: A(plan), role: m.seats[i].role, lead: m.seats[0].role, file: A(note(2, i)) }) }));
        }
        return [{ seat: 0, doing: 'merging the work', file: m.output, ask: say('meeting.lead.merge', { reports: notes(2, team), output: A(m.output) }) }];
      }
      case 'mapreduce': {
        if (step > 1) return null;
        const mappers = all.slice(1);
        if (round === 1) {
          return mappers.map((i, k) => {
            const mine = (m.parts ?? []).filter((_, j) => j % mappers.length === k);
            return { seat: i, doing: 'mapping', file: note(1, i), ask: say('meeting.mapreduce.map', { parts: mine.map((x) => `- ${x}`).join('\n'), file: A(note(1, i)) }) };
          });
        }
        return [{ seat: 0, doing: 'reducing', file: m.output, ask: say('meeting.mapreduce.reduce', { results: notes(1, mappers), output: A(m.output) }) }];
      }
      case 'redblue': {
        const [blue, red] = [0, 1];
        const redNote = `${m.notes}/r${round}-red.md`;
        const blueNote = `${m.notes}/r${round}-blue.md`;
        if (step === 1) {
          const before = round > 1 ? ` The Blue team's fixes from round ${round - 1} are in ${A(`${m.notes}/r${round - 1}-blue.md`)}: check them first, then keep looking.` : '';
          return [{ seat: red, doing: 'attacking', file: redNote, ask: say('meeting.redblue.attack', { previousFixes: before, file: A(redNote) }) }];
        }
        if (step > 2) return null;
        if (m.lastRound === round) {
          return [{ seat: blue, doing: 'writing it up', file: m.output, ask: say('meeting.redblue.writeup', { findings: A(redNote), notes: A(m.notes), output: A(m.output) }) }];
        }
        const wrap = last ? ` This is the last round: once you've fixed things, also write ${A(m.output)}: every finding from every round (${A(m.notes)}/), what was fixed and how, and what's still open. That file is the meeting's output.` : '';
        return [{ seat: blue, doing: last ? 'fixing and writing it up' : 'fixing', file: last ? m.output : blueNote, ask: say('meeting.redblue.fix', { findings: A(redNote), file: A(blueNote), lastRound: wrap, output: A(m.output) }) }];
      }
      case 'review': {
        if (step > 1) return null;
        if (round === 1) {
          return all.map((i) => ({
            seat: i,
            doing: 'reviewing',
            file: note(1, i),
            ask: say('meeting.review.review', { pr: m.pr, role: m.seats[i].role, file: A(note(1, i)) }),
          }));
        }
        return [{ seat: 0, doing: 'writing the review', file: m.output, ask: say('meeting.review.combine', { findings: notes(1, all), exampleRole: m.seats[1]?.role ?? 'Security', output: A(m.output) }) }];
      }
    }
  
  return null;
}
