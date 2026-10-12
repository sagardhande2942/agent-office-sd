import './style.css';
import type { Net } from '../../net';
import type { BossControl,BossConfig } from '../../../shared/boss-mode/types';
import { store } from '../../state';
import { h,openModal,toast } from '../../ui/dom';
import { confirmDialog } from '../../ui/prompt';
import { settingsForm } from './settings';
import { BOSS_TABS,renderBossView,type BossTab } from './views';
import { bossConnection } from './connection';
let current:ReturnType<typeof openModal>|undefined;
export function openBossConsole(net:Net,terminal:(id:string)=>void) {
  if(current?.el.isConnected)return current;
  const floor=store.floor;
  let tab:BossTab=store.bossMode.config.mission?'Overview':'Settings',dirty=false,settings:HTMLElement|undefined,pendingSave:string|undefined;
  const status=h('span.boss-state',{role:'status'}),toggle=h('button.boss-power',{type:'button',role:'switch','aria-label':'Boss mode ON/OFF'});
  const close=h('button.btn.close',{type:'button','aria-label':'Close Boss Office'},'✕');
  const title=h('h2',{},'Boss Office'),project=h('span.boss-project',{},store.project?.name??'Current project');
  const nav=h('nav.boss-nav',{'aria-label':'Boss Office views'}),body=h('div.boss-content');
  const connection=h('div.boss-connection',{role:'status','aria-live':'polite'});
  const steering=h('textarea',{rows:2,maxlength:8000,placeholder:'Steer the boss: priorities, constraints, or a new direction…','aria-label':'Steer the boss'});
  const send=h('button.btn.primary',{type:'submit'},'Send instruction'),ack=h('p.boss-ack',{'aria-live':'polite'});
  const compose=h('form.boss-steering',{},h('div',{},steering,ack),send);
  const el=h('div.modal.boss-office',{role:'dialog','aria-label':'Boss Office'},h('header.boss-header',{},h('div',{},h('span.boss-eyebrow',{},'PROJECT COMMAND CENTER'),title,project),h('div.boss-header-actions',{},status,toggle,close)),connection,nav,body,compose);
  const availability=()=>bossConnection(store.bossMode,net.up,store.currentFloor()?.host?.reachable);
  const control=(value:BossControl)=>{const state=availability();if(!state.ready){toast(state.text,'warn');return false;}net.send({t:'boss.control',control:value});return true;};
  const disabledBefore=new WeakMap<HTMLButtonElement,boolean>();
  const updateButtons=()=>body.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{if(!availability().ready){if(!disabledBefore.has(button))disabledBefore.set(button,button.disabled);button.disabled=true;}else if(disabledBefore.has(button)){button.disabled=disabledBefore.get(button)!;disabledBefore.delete(button);}});
  const change=(next:BossTab)=>{
    const apply=()=>{if(tab==='Settings'&&dirty){dirty=false;settings=undefined;}if(next!==tab)settings=undefined;tab=next;render();body.scrollTop=0;};
    if(tab==='Settings'&&dirty&&next!==tab)confirmDialog('Discard unsaved settings?','Your running boss keeps its saved configuration.','Discard',apply);else apply();
  };
  const save=(config:BossConfig)=>{if(control({action:'configure',config})){pendingSave=JSON.stringify(config);toast('Saving configuration…');}};
  const render=()=>{
    const state=store.bossMode;
    const available=availability();connection.textContent=available.text;connection.hidden=available.ready;
    const unsupported=state.connection==='unsupported'&&net.up&&store.currentFloor()?.host?.reachable!==false;
    el.setAttribute('aria-busy',String(!available.ready&&!unsupported));
    status.textContent=!available.ready?(unsupported?'Host update required':'Connecting…'):state.draining?'Finishing current work':state.phase;status.dataset.phase=available.ready?state.phase:unsupported?'blocked':'connecting';
    toggle.textContent=!available.ready?(unsupported?'N/A':'WAIT'):state.enabled?'ON':'OFF';toggle.setAttribute('aria-checked',String(state.enabled));toggle.disabled=!store.me.admin||!available.ready;
    nav.replaceChildren(...BOSS_TABS.map(name=>h('button',{type:'button','aria-current':tab===name?'page':undefined,onclick:()=>change(name)},name)));
    steering.disabled=!store.me.admin;send.disabled=!store.me.admin||!available.ready;
    const last=state.steering.at(-1);ack.textContent=last?last.status+' · '+last.text:store.me.admin?'Instructions apply at the next safe checkpoint.':'Monitoring only · admin controls required.';
    if(tab==='Settings'){
      if(settings){updateButtons();return;}
      const form=settingsForm(state.config,save,()=>{dirty=true;});
      const preset=h('select',{'aria-label':'Boss preset'},h('option',{value:''},'Choose a saved preset'),...state.presets.map(p=>h('option',{value:p.id},p.name)));
      preset.addEventListener('change',()=>{const p=state.presets.find(p=>p.id===preset.value);if(!p)return;const apply=()=>{dirty=true;body.querySelector('.boss-settings')?.replaceWith(settingsForm(p.config,save,()=>{dirty=true;}));};if(dirty)confirmDialog('Replace settings draft?','Load this preset into the form. Save changes to apply it.','Load preset',apply);else apply();});
      const name=h('input',{placeholder:'Preset name','aria-label':'Preset name',maxlength:100});
      settings=h('div',{},h('section.boss-section',{},h('h3',{},'Reusable presets'),h('div.boss-actions',{},preset,name,h('button.btn',{disabled:!store.me.admin,onclick:()=>{if(dirty)return toast('Save or discard settings before saving a preset','warn');if(!name.value.trim())return toast('Enter a preset name','warn');control({action:'preset-save',name:name.value.trim()});settings=undefined;}},'Save current configuration'),h('button.btn',{disabled:!store.me.admin,onclick:()=>{if(dirty)return toast('Save or discard settings before deleting a preset','warn');if(preset.value){control({action:'preset-delete',id:preset.value});settings=undefined;}}},'Delete preset'))),form,h('button.btn',{onclick:()=>{dirty=false;settings=undefined;render();}},'Discard changes'));
      if(!store.me.admin)settings.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea,button').forEach(c=>c.disabled=true);
      body.replaceChildren(settings);updateButtons();return;
    }
    body.replaceChildren(renderBossView(tab,state,{control,tab:change,terminal:id=>{if(['offline','exited'].includes(store.workers.get(id)?.status??''))return toast('Terminal is suspended; turn Boss mode on to resume retained work.','warn');modal.close();if(!el.isConnected)terminal(id);}}));
    updateButtons();
  };
  toggle.addEventListener('click',()=>{
    if(!store.bossMode.enabled&&(!store.bossMode.config.mission.trim()||!store.bossMode.config.checks.length)){change('Settings');toast('Save a mission and independent verification commands first.','warn');return;}
    control({action:store.bossMode.enabled?'off':'on'});
  });
  compose.addEventListener('submit',e=>{e.preventDefault();if(steering.value.trim()&&control({action:'steer',text:steering.value.trim()}))steering.value='';});
  const off=store.on('bossMode',()=>{if(pendingSave===JSON.stringify(store.bossMode.config)){pendingSave=undefined;dirty=false;settings=undefined;toast('Configuration saved.');}if(tab==='Settings'&&!dirty)settings=undefined;render();});
  const offWorkers=store.on('workers',()=>{if(tab==='Overview'||tab==='Work')render();});
  const offMe=store.on('me',()=>{settings=undefined;render();});
  const offFloor=store.on('floor',()=>{if(store.floor!==floor){dirty=false;originalClose();}});
  const offFloors=store.on('floors',()=>render());
  const modal=openModal(el,{closeButton:false,doing:'managing Boss Office',onClose:()=>{off();offWorkers();offMe();offFloor();offFloors();offStatus();current=undefined;}});
  const offStatus=net.onStatus(()=>render());
  const originalClose=modal.close.bind(modal);
  modal.close=()=>{if(dirty)confirmDialog('Discard unsaved settings?','Saved settings and unattended execution remain active.','Discard',()=>{dirty=false;originalClose();});else originalClose();};
  close.addEventListener('click',()=>modal.close());current=modal;
  net.send({t:'boss.get'});render();return modal;
}
