import type { ActivitySnapshot } from '../../shared/activity-heatmap.js';
export class RemoteActivityHeatmap {
  constructor(private call: (name: string, body: Record<string, unknown>) => Promise<unknown>) {}
  async snapshot(): Promise<ActivitySnapshot> {
    const result = await this.call('activity-heatmap.snapshot', {});
    if (!result || typeof result !== 'object' || (result as ActivitySnapshot).version !== 1) throw Error('Update the floor host to support activity heatmaps');
    return result as ActivitySnapshot;
  }
}
