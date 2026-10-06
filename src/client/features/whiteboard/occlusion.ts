import { WHITEBOARD } from '../../../shared/layout';
import type { Collider } from '../../world/types';

/** The writing panel and stand are thin; their walking envelope includes open air around the feet. */
export function whiteboardOcclusion(): Collider[] {
  const {x,z,width,height,bottom}=WHITEBOARD;
  const box=(cx:number,cy:number,cz:number,w:number,h:number,d:number):Collider=>({minX:cx-w/2,maxX:cx+w/2,minZ:cz-d/2,maxZ:cz+d/2,bottom:cy-h/2,top:cy+h/2});
  const post=width/2+.1;
  return [
    box(x,bottom+height/2,z,width+.14,height+.14,.08),
    box(x,.3,z,post*2,.05,.05),
    box(x,bottom-.1,z+.09,width*.55,.04,.14),
    ...[-post,post].flatMap(sx=>[
      box(x+sx,(bottom+height+.2)/2+.1,z,.1,bottom+height+.4,.1),
      box(x+sx,.13,z,.09,.07,.95),
      ...[-.42,.42].map(sz=>box(x+sx,.055,z+sz,.04,.11,.11)),
    ]),
  ];
}
