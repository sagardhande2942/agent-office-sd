import type { BossState } from '../../../shared/boss-mode/types';
export function bossConnection(state: BossState, online: boolean, hostReachable?: boolean) {
  if (!online) return { ready: false, text: 'Connecting to office… Your last known Boss state is preserved.' };
  if (hostReachable === false) return { ready: false, text: 'Reconnecting to floor host… Waiting for live Boss state.' };
  if (state.connection === 'unsupported') return { ready: false, text: 'This connected floor host does not support Boss mode. Update and restart the floor host.' };
  if (state.connection === 'connecting') return { ready: false, text: 'Connecting to floor host… Waiting for Boss mode to be ready.' };
  return { ready: true, text: '' };
}
