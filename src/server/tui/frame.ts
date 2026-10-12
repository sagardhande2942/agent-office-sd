/** Paint changed rows without blanking the screen between live updates. */
export class TuiFrame {
  private previous:string[]=[];
  private width=0;
  private height=0;
  reset(){this.previous=[];this.width=0;this.height=0;}
  paint(rows:readonly string[],width:number,height:number):string {
    const fresh=width!==this.width||height!==this.height;
    const next=Array.from({length:height},(_,i)=>rows[i]??'');
    let changes='';
    for(let i=0;i<height;i++)if(fresh||next[i]!==this.previous[i]){
      changes+=`\x1b[${i+1};1H\x1b[0m`+next[i]+'\x1b[0m\x1b[K';
    }
    this.previous=next;this.width=width;this.height=height;
    if(!changes)return '';
    // Disable auto-wrap while painting: writing the bottom-right cell must not scroll.
    return '\x1b[?25l\x1b[?7l'+(fresh?'\x1b[2J':'')+changes+'\x1b[?7h';
  }
}
