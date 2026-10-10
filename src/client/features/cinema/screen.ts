import * as THREE from 'three';
import { SCREEN } from '../../../shared/cinema';

// What the screening room's screen shows: the shot of the build, and its caption under it. Both are
// ordinary canvases drawn here and given to the two meshes as textures (see world.ts), so the reel is
// painted by the same code the window shows, at whatever size the screen is.

// The screen is 2.4 m across: enough pixels that a screenshot of a window is sharp from the back row.
const SCREEN_PX = 1024;
const CAPTION_PX = 1024;
const CAPTION_H = 128;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/** The two textures on the screening room's wall, and the pictures they are painted from. */
export class ScreenPainter {
  private readonly shot = document.createElement('canvas');
  private readonly caption = document.createElement('canvas');
  private readonly shotTex: THREE.CanvasTexture;
  private readonly captionTex: THREE.CanvasTexture;
  /** The shots already fetched, by `${reel}/${n}`, so a reel that comes back round isn't re-fetched. */
  private readonly pictures = new Map<string, HTMLImageElement>();
  /** What each canvas was last painted with, so an unchanged shot isn't drawn again. */
  private drawn = '';
  private said = '';
  /** What is on the screen now, kept so the font loading can paint it again with the office's. */
  private now: { reel: string; n: number; caption: string; floor: string } | null = null;

  constructor(screen: THREE.Mesh<THREE.PlaneGeometry>, plate: THREE.Mesh<THREE.PlaneGeometry>) {
    this.shot.width = SCREEN_PX;
    this.shot.height = Math.round((SCREEN_PX * SCREEN.height) / SCREEN.width);
    this.caption.width = CAPTION_PX;
    this.caption.height = CAPTION_H;
    this.shotTex = new THREE.CanvasTexture(this.shot);
    this.captionTex = new THREE.CanvasTexture(this.caption);
    for (const t of [this.shotTex, this.captionTex]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
    }
    (screen.material as THREE.MeshBasicMaterial).map = this.shotTex;
    (screen.material as THREE.MeshBasicMaterial).needsUpdate = true;
    (plate.material as THREE.MeshBasicMaterial).map = this.captionTex;
    (plate.material as THREE.MeshBasicMaterial).transparent = true;
    (plate.material as THREE.MeshBasicMaterial).needsUpdate = true;
    this.idle('Nothing on the screening room');
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => this.repaint());
  }

  /** What the screen says when there is no reel on it. */
  idle(text: string) {
    const g = this.shot.getContext('2d')!;
    g.fillStyle = '#141726';
    g.fillRect(0, 0, this.shot.width, this.shot.height);
    g.fillStyle = '#4a4f6a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${Math.round(this.shot.height / 12)}px ${FONT}`;
    g.fillText('🎬', this.shot.width / 2, this.shot.height / 2 - this.shot.height / 14);
    g.font = `700 ${Math.round(this.shot.height / 26)}px ${FONT}`;
    g.fillText(text, this.shot.width / 2, this.shot.height / 2 + this.shot.height / 12);
    this.shotTex.needsUpdate = true;
    this.say('');
  }

  /** The shot `n` of `reel`, from the office's copy of it, with its caption under. */
  async show(reel: string, n: number, caption: string, floor: string) {
    this.now = { reel, n, caption, floor };
    this.say(caption);
    const key = `${floor}/${reel}/${n}`;
    const picture = this.pictures.get(key) ?? (await this.fetch(key, floor, reel, n));
    if (!picture) return;
    const g = this.shot.getContext('2d')!;
    const { width: w, height: h } = picture;
    // Cover the screen, cropping the overflow the way CSS object-fit does.
    const scale = Math.max(this.shot.width / w, this.shot.height / h);
    const dw = w * scale;
    const dh = h * scale;
    g.drawImage(picture, (this.shot.width - dw) / 2, (this.shot.height - dh) / 2, dw, dh);
    this.drawn = key;
    this.shotTex.needsUpdate = true;
  }

  /** The caption plate under the screen, on as many lines as it takes. */
  private say(text: string) {
    if (text === this.said) return;
    this.said = text;
    const g = this.caption.getContext('2d')!;
    g.clearRect(0, 0, this.caption.width, this.caption.height);
    g.fillStyle = 'rgba(20,23,38,.92)';
    g.fillRect(0, 0, this.caption.width, this.caption.height);
    g.fillStyle = '#fdfbf7';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 44px ${FONT}`;
    const lines = wrap(g, text, this.caption.width - 48, 2);
    lines.forEach((line, i) => g.fillText(line, this.caption.width / 2, this.caption.height / 2 + (i - (lines.length - 1) / 2) * 50));
    this.captionTex.needsUpdate = true;
  }

  /**
   * Draws both canvases again, once the office's font has loaded: the text on them was drawn in the
   * fallback face until then, so it is painted once more now it isn't.
   */
  repaint() {
    const now = this.now;
    if (!now) return;
    this.said = '';
    this.say(now.caption);
    this.drawn = '';
    void this.show(now.reel, now.n, now.caption, now.floor);
  }

  /** The office's copy of a shot: `/api/cinema/shot`, which is a PNG of the build on this floor. */
  private async fetch(key: string, floor: string, reel: string, n: number): Promise<HTMLImageElement | undefined> {
    const picture = new Image();
    picture.src = `/api/cinema/shot?floor=${encodeURIComponent(floor)}&reel=${encodeURIComponent(reel)}&n=${n}`;
    try {
      await picture.decode();
    } catch {
      return undefined;
    }
    this.pictures.set(key, picture);
    return picture;
  }

  /** Lets go of the shots of reels no longer on the screen. */
  forget(keep: string[]) {
    for (const key of [...this.pictures.keys()]) if (!keep.some((k) => key.includes(`/${k}/`))) this.pictures.delete(key);
  }
}

/** `text` on at most `max` lines, each at most `width` wide. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if (line && g.measureText(`${line} ${word}`).width <= width) lines[lines.length - 1] = `${line} ${word}`;
    else if (lines.length < max) lines.push(word);
    else return lines;
  }
  return lines;
}
