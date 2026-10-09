import './ui.css';
import { FICTIONAL_CHARACTERS, validAppearanceConfig } from '../../../shared/appearances';
import { store } from '../../state';
import type { Net } from '../../net';
import { h } from '../../ui/dom';
import { characterPortraits } from './portraits';
export function appearanceSetting(net: Net) {
  let draft=structuredClone(store.appearances.config);
  let applied=JSON.stringify(draft);
  const element=h('div.setting.appearance-setting',{},h('div.setting-head',{},h('h4',{},'Worker appearances'),h('span.scope.office',{},'Everyone')));
  const categories=h('div.appearance-categories');
  const cards=h('div.appearance-roster');
  const note=h('p.setting-note');
  const apply=h('button.btn.primary',{type:'button',onclick:()=>net.send({t:'appearance.set',config: draft})},'Apply appearances');
  const all=h('button.btn',{type:'button',onclick:()=>{draft.characters=FICTIONAL_CHARACTERS.map(([id])=>id);paint();}},'Select all');
  const clear=h('button.btn',{type:'button',onclick:()=>{draft.characters=[];paint();}},'Clear');
  const actions=h('div.seg',{},all,clear,apply);
  const portraits=characterPortraits();
  const paint=()=>{
    const admin=store.me.admin;
    categories.replaceChildren(...(['original','fictional'] as const).map(id=>{
      const input=h('input',{type:'checkbox','aria-label':`${id === 'original' ? 'Original' : 'Fictional'} workers`,disabled:!admin});input.checked=draft.categories.includes(id);
      input.addEventListener('change',()=>{draft.categories=input.checked?[...draft.categories,id]:draft.categories.filter(c=>c!==id);paint();});
      return h('label',{},input,id==='original'?'Original':'Fictional');
    }));
    cards.replaceChildren(...FICTIONAL_CHARACTERS.map(([id,name])=>{
      const input=h('input',{type:'checkbox','aria-label':`Enable ${name}`,disabled:!admin});input.checked=draft.characters.includes(id);
      input.addEventListener('change',()=>{draft.characters=input.checked?[...draft.characters,id]:draft.characters.filter(c=>c!==id);paint();});
      return h('label.appearance-card',{class:input.checked?'selected':''},h('img',{src:portraits.get(id),alt:name,width:100,height:100}),h('span',{},input,name));
    }));
    const valid=validAppearanceConfig(draft);
    apply.disabled=!admin||!valid||JSON.stringify(draft)===applied;all.disabled=clear.disabled=!admin;
    note.textContent=!admin?'Only admins can change appearances.':!valid?'Choose at least one category and one fictional character when Fictional is enabled.':'Applies immediately across every floor. Each selected fictional character is used once; extra workers use Original. Mixed categories alternate new workers, starting with Original. Signature outfits are included.';
  };
  const sync=()=>{const config=JSON.stringify(store.appearances.config);if(config!==applied){applied=config;draft=structuredClone(store.appearances.config);}paint();};
  const off=[store.on('appearances',sync),store.on('me',paint)];
  element.append(categories,cards,actions,note);paint();
  return {element,dispose:()=>off.forEach(f=>f())};
}
