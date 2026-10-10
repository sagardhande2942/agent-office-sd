// Where a shot's picture is, and the pictures already fetched. One place, because the wall and the
// window both want the same one (see screen.ts and ui.ts), and a URL built twice is a URL that can be
// fixed in one place and missed in the other.

// How a floor's shots are addressed: which reel, which shot (see server/cinema.ts and its route).
export function shotUrl(floor: string, reel: string, n: number): string {
  return `/api/cinema/shot?floor=${encodeURIComponent(floor)}&reel=${encodeURIComponent(reel)}&n=${n}`;
}

/** The shots a floor has already fetched, by reel and number, so a reel that comes round isn't re-read. */
export class ShotCache {
  private readonly pictures = new Map<string, HTMLImageElement>();

  /** The picture, fetched if this is the first time it has been asked for. Undefined if it isn't one. */
  async get(floor: string, reel: string, n: number): Promise<HTMLImageElement | undefined> {
    const key = `${floor}/${reel}/${n}`;
    const had = this.pictures.get(key);
    if (had) return had;
    const picture = new Image();
    picture.src = shotUrl(floor, reel, n);
    try {
      await picture.decode();
    } catch {
      return undefined;
    }
    this.pictures.set(key, picture);
    return picture;
  }

  /** Lets go of the shots of reels no longer on the screen: `keep` is the reels' ids. */
  forget(keep: readonly string[]) {
    const reels = new Set(keep);
    for (const key of [...this.pictures.keys()]) {
      const [, reel] = key.split('/');
      if (!reels.has(reel)) this.pictures.delete(key);
    }
  }
}
