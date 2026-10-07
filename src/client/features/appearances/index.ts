import type { Ctx } from '../../core/context';
import type { WorkerView } from '../workers/views';
import { store } from '../../state';
import { registerSettingsExtension } from '../../ui/settings-extensions';
import { appearanceSetting } from './ui';
import { registerFictionalCharacters } from './characters';
export function installAppearances(ctx: Ctx, workerViews: Map<string, WorkerView>) {
  registerFictionalCharacters();
  registerSettingsExtension({ pane:'workers', create:appearanceSetting });
  const sync=()=>{for(const [id,view] of workerViews) view.model.setAppearance(store.appearances.assignments[id]??'original');};
  store.on('appearances',sync);
  // Models can arrive after the assignment message, including walking helpers.
  ctx.ticks.add('world',sync);
}
