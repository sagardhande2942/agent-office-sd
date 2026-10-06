import { Vitals, LOW_ENERGY, HIGH_STRESS, ENERGY_DRAIN, STRESS_DRAIN } from '../../vitals';
import { $ } from '../../ui/dom';
let vitalsKey='';
export function renderVitals(vitals: Vitals, now: number) {
  const energy = vitals.energyLeft(now);
  const stress = vitals.strain(now);
  // Both move so slowly that half a percent of the bar is under a pixel: only redraw it that often.
  const k = `${Math.round(energy * 200)}|${Math.round(stress * 200)}`;
  if (k === vitalsKey) return;
  vitalsKey = k;
  const el = $('vitals');
  el.classList.toggle('low', energy <= LOW_ENERGY);
  el.classList.toggle('wound', stress >= HIGH_STRESS);
  // The bars ease over a second (see their CSS transition), so aim for where they'll be in one.
  $('energy-fill').style.width = `${Math.max(0, energy - ENERGY_DRAIN) * 100}%`;
  $('stress-fill').style.width = `${Math.min(1, stress + STRESS_DRAIN) * 100}%`;
}
