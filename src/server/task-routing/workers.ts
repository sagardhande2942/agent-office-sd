/** Single desk workers use the proven execution/gate engine, without reserving meeting spaces. */
import path from 'node:path';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { DESKS } from '../../shared/layout.js';
import type { Floor, FloorContext } from '../floor.js';
import type { Meeting } from '../../shared/protocol.js';
import { MeetingRoom, type MeetingWorkers } from '../meetings.js';
import { Worktrees } from '../worktrees.js';
import { meetingMemoryContext, meetingMemoryGate } from '../knowledge/meetings.js';
import { atomicWrite } from '../knowledge/store.js';
import { registerWorkerTasks, unregisterWorkerTasks } from './worker-memory.js';
import { findWorkerTask, meetingArtifacts } from './results.js';
import { taskProblem, type QueueTask } from './bridge.js';

export class RoutedWorkers {
  private rooms = new Map<string, MeetingRoom>();
  private index: Record<string,string>;
  private file: string;
  constructor(private floor: Floor, private ctx: FloorContext, private owner?: string) {
    this.file = path.join(floor.def.dir,'.agent-office/worker-tasks/index.json');
    this.index = existsSync(this.file) ? JSON.parse(readFileSync(this.file,'utf8')) : {};
    if (!this.index || typeof this.index !== 'object' || Array.isArray(this.index) || Object.entries(this.index).some(([k,v]) => !k || !/^[a-f0-9]{16}$/.test(v))) throw Error('Invalid worker task index');
    registerWorkerTasks(floor, () => this.state());
    for (const id of Object.values(this.index)) {
      const state = this.saved(id);
      if (state?.current?.status === 'running') this.room(id);
    }
  }
  private saved(id: string) {
    const file=path.join(this.floor.def.dir,'.agent-office/worker-tasks',id,'meetings.json');
    return existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : undefined;
  }
  state(): Meeting[]{return [...this.rooms.values()].map(r=>r.state().current).filter((m):m is Meeting=>!!m);}
  available() { return this.ctx.capacity.room() >= 1 && DESKS.some(d=>!this.floor.workers.deskOccupied(d.id)); }
  pump(){for(const room of this.rooms.values())room.pump();}
  find(key: string) { this.pump(); return findWorkerTask(this.floor,key); }
  async start(task: QueueTask, key: string, id: string) {
    const bad=taskProblem(task);if(bad||task.execution!=='worker'||!/^[a-f0-9]{16}$/.test(id)||!key||key.length>200)throw Error(bad??'Invalid worker task identity');
    if (this.index[key]) throw Error('Worker task start already recorded; reconcile instead of replaying');
    // Persist intent before creating a checkout or spawning a provider session.
    this.index[key]=id; atomicWrite(this.file,JSON.stringify(this.index));
    const artifacts=meetingArtifacts(this.floor,task.references??[]);
    const prompt=JSON.stringify({task_id:task.id,input:task.input,previous_artifacts:artifacts.references});
    if (prompt.length>19000) throw Error('Task packet exceeds brief capacity');
    const error=this.room(id).start({pattern:'custom',workflow:task.workflow,title:task.title,prompt,roles:task.workflow.roles},'Task router',this.owner,{key,id,inputs:artifacts.files});
    if(error)throw Error(error);
    const current=this.find(key);if(!current)throw Error('Worker task start acceptance ambiguous');return current;
  }
  async retire(id: string, key: string) {
    if(this.index[key]!==id)throw Error('Worker task identity mismatch');
    const room=this.rooms.get(id) ?? (this.saved(id)?.current?.id===id ? this.room(id) : undefined);
    if(room){const error=room.clear('Task router');if(error)throw Error(error);room.shutdown();this.rooms.delete(id);}
  }
  private room(id: string) {
    const old=this.rooms.get(id);if(old)return old;
    const floor=this.floor,ctx=this.ctx;
    const manager: MeetingWorkers = {
      defaultProvider:floor.workers.defaultProvider,officeDefault:floor.workers.officeDefault,
      list:()=>floor.workers.list(),activeSince:(w,at)=>floor.workers.activeSince(w,at),
      seat:(_desk,by,prompt,provider,model,effort,meeting,owner)=>{
        const desk=DESKS.find(d=>!floor.workers.deskOccupied(d.id));if(!desk)return 'No free desk for routed task';
        return floor.workers.spawn(desk.id,by,prompt,false,'agent',provider,model,effort,undefined,owner,[],undefined,undefined,undefined,undefined,undefined,{id:meeting.id,worktree:meeting.worktree});
      },
      prompt:(...args)=>floor.workers.prompt(...args),write:(...args)=>floor.workers.write(...args),kill:id=>floor.workers.kill(id),
    };
    const dir=path.join(floor.def.dir,'.agent-office/worker-tasks',id);mkdirSync(dir,{recursive:true});
    const room=new MeetingRoom(floor.def.dir,dir,manager,new Worktrees(floor.def.dir),{
      update(){},toast:(text,level)=>ctx.toast(floor,text,level),hiringPaused:()=>ctx.ledger.hiringPaused,
      postReview:async()=>{throw Error('Desk tasks cannot post reviews');},
      memoryContext:m=>meetingMemoryContext(floor.def.dir,m),memoryGate:m=>meetingMemoryGate(floor.def.dir,m),
      communications:()=>ctx.communications?.(floor)??{messages:[]},
    });
    this.rooms.set(id,room);return room;
  }
  close(){for(const room of this.rooms.values())room.shutdown();this.rooms.clear();unregisterWorkerTasks(this.floor);}
}
