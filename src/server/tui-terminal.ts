import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { screenSnapshot, withoutFullScreen } from './screen.js';

const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l';

/** Local scrollback while the dashboard owns the host terminal's alternate screen. */
export class TuiTerminal {
  private readonly term: InstanceType<typeof headless.Terminal>;
  private readonly ser = new serialize.SerializeAddon();
  private offset = 0;
  private pending = '';
  private pasting = false;
  private disposed = false;
  private lastBase = 0;

  constructor(cols: number, rows: number, private readonly output: (data: string) => void, reply: (data: string) => void = () => {}) {
    this.term = new headless.Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
    this.term.loadAddon(this.ser as any);
    this.term.onData(reply);
    // Keep worker full-screen modes out of the local buffer, including split escape sequences.
    screenSnapshot(this.term, this.ser);
  }

  write(data: string, snapshot = false, cols?: number, rows?: number): Promise<void> {
    if (snapshot) this.term.reset();
    if (cols && rows) this.term.resize(cols, rows);
    return new Promise(resolve => this.term.write(withoutFullScreen(data, this.term.rows), () => {
      if (!this.disposed) {
        const base = this.term.buffer.normal.baseY;
        if (this.offset && !snapshot) this.offset += Math.max(0, base - this.lastBase);
        this.lastBase = base;
        this.offset = Math.min(this.offset, base);
        this.draw();
      }
      resolve();
    }));
  }

  resize(cols: number, rows: number) { this.term.resize(cols, rows); this.draw(); }

  /** Consume history gestures locally; return only actual worker input. Escape codes may span chunks. */
  input(data: string): string {
    this.pending += data;
    let forwarded = '';
    while (this.pending) {
      if (this.pasting) {
        const end = this.pending.indexOf('\x1b[201~');
        if (end >= 0) {
          forwarded += this.pending.slice(0, end + 6);
          this.pending = this.pending.slice(end + 6); this.pasting = false;
          continue;
        }
        const escape = this.pending.lastIndexOf('\x1b');
        const keep = escape >= 0 && '\x1b[201~'.startsWith(this.pending.slice(escape)) ? escape : this.pending.length;
        forwarded += this.pending.slice(0, keep); this.pending = this.pending.slice(keep);
        break;
      }
      if (this.pending.startsWith('\x1b[200~')) {
        forwarded += this.pending.slice(0, 6); this.pending = this.pending.slice(6);
        this.pasting = true; continue;
      }
      const sequence = /^(\x1b\[(?:5|6)~|\x1b\[<(\d+);\d+;\d+[Mm])/.exec(this.pending);
      if (sequence) {
        const code = sequence[2] === undefined ? undefined : Number(sequence[2]);
        if (code === undefined) this.scroll(sequence[1] === '\x1b[5~' ? this.term.rows - 1 : 1 - this.term.rows);
        else if ((code & 64) && !(code & 128) && (code & 3) < 2) this.scroll((code & 1) ? -3 : 3);
        else if (this.term.modes.mouseTrackingMode !== 'none') forwarded += sequence[0];
        this.pending = this.pending.slice(sequence[0].length);
        continue;
      }
      // Only buffer incomplete sequences belonging to our controls; ordinary Escape passes through.
      if (/^\x1b(?:\[(?:[56]?|2(?:0(?:0)?)?|<\d*(?:;\d*){0,2}))?$/.test(this.pending)) break;
      forwarded += this.pending[0];
      this.pending = this.pending.slice(1);
    }
    if (forwarded && this.offset) { this.offset = 0; this.draw(); }
    return forwarded;
  }

  flushInput(): string {
    if (this.pasting) return '';
    const data = this.pending; this.pending = '';
    if (data && this.offset) { this.offset = 0; this.draw(); }
    return data;
  }

  private scroll(lines: number) {
    this.offset = Math.max(0, Math.min(this.term.buffer.normal.baseY, this.offset + lines));
    this.draw();
  }

  private draw() {
    if (this.disposed) return;
    const buf = this.term.buffer.normal;
    const start = Math.max(0, buf.baseY - this.offset);
    const screen = this.ser.serialize({ range: { start, end: start + this.term.rows - 1 }, excludeModes: true, excludeAltBuffer: true });
    const cursor = this.offset ? '' : `\x1b[${buf.cursorY + 1};${buf.cursorX + 1}H`;
    const modes = `\x1b[?1${this.term.modes.applicationCursorKeysMode ? 'h' : 'l'}\x1b[?2004${this.term.modes.bracketedPasteMode ? 'h' : 'l'}`;
    this.output('\x1b[0m\x1b[H\x1b[2J' + screen + cursor + modes + (this.offset ? '\x1b[?25l' : '\x1b[?25h') + MOUSE_ON);
  }

  dispose() { if (this.disposed) return; this.disposed = true; this.term.dispose(); this.output(MOUSE_OFF + '\x1b[?1l\x1b[?2004l'); }
}
