export class RemoteHandoff {
  constructor(private call: (type: string) => Promise<unknown>) {}
  list() { return this.call('handoff.list'); }
}
