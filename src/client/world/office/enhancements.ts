import { buildDanceFloor, type DanceFloorView } from '../disco';
import { buildTheatre, type TheatreView } from '../theatre';
import { officeFinishes } from '../officefinishes';
import type { Fixture } from './fixture';
declare module '../types' {
 interface OfficeHandles { danceFloor: DanceFloorView; theatre: TheatreView; setInterior(modern:boolean):void; }

}
export const enhancements: Fixture<'danceFloor'|'theatre'|'setInterior'> = site => {
 const danceFloor=buildDanceFloor(); const theatre=buildTheatre();
 site.group.add(danceFloor.group,theatre.group);
 const finish=officeFinishes(site.group,site.desks,site.get('pendants'),[site.looks.wall,site.looks.trim]); finish(false);
 return { handle: { danceFloor,theatre,setInterior:finish }, interactables:[theatre.interactable], update:(t,dt)=> { danceFloor.update(t); theatre.update(dt); } };
};
