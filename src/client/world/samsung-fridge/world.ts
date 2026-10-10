import { kitchen } from '../kitchen';
import { model } from '../models';
import type { Fixture } from '../office/fixture';
import { samsungFridge } from './controller';

/** Wrap the kitchen fixture so it still gives exactly one fridge handle. */
export const samsungKitchen: Fixture<'fridge'> = site => {
  const built = kitchen(site);
  const asset = model('samsung-fridge');
  const previous = built.handle?.fridge;
  if (!asset || !previous || !built.group) return built;
  const fridge = samsungFridge(asset.scene, {
    x: previous.group.position.x, z: previous.group.position.z, rotY: previous.group.rotation.y,
  });
  if (!fridge) return built;
  previous.group.removeFromParent();
  built.group.add(fridge.group);
  return {
    ...built, handle: { fridge },
    interactables: built.interactables?.map(it => it === previous.interactable ? fridge.interactable : it),
    update: (_t, dt) => fridge.update(dt),
  };
};
