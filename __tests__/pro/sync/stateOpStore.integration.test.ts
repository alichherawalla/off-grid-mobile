import { installRealSqlite } from '../../harness/sqliteFake';

/**
 * Mobile startup must compact the durable op log before whole-record snapshots enter the JS heap.
 *
 * This uses the real Pro store, the real shared sync store, and a real in-memory SQLite engine. Only
 * the native op-sqlite binding is replaced. Repeated large snapshots are the production failure:
 * loading all of them before the normal in-memory compaction can exhaust a phone's process.
 */
describe('Pro state op store startup', () => {
  it('deletes superseded snapshots before returning the startup log', async () => {
    installRealSqlite();

    const { StateOpStore } = require('../../../pro/sync/stateOpStore');
    const { countOps } = require('@offgrid/sync');
    const { opStoreDriver } = require('../../../pro/sync/opStoreDriver');
    const store = new StateOpStore();

    await store.load();
    store.append({
      opId: 'old-task',
      entity: 'task',
      entityId: 'task-1',
      kind: 'put',
      fields: { text: 'old '.repeat(100_000) },
      lamport: 1,
      deviceId: 'phone',
      ts: 1,
    });
    store.append({
      opId: 'current-task',
      entity: 'task',
      entityId: 'task-1',
      kind: 'put',
      fields: { text: 'current' },
      lamport: 2,
      deviceId: 'phone',
      ts: 2,
    });
    expect(countOps(opStoreDriver)).toBe(2);

    const loaded = await new StateOpStore().load();

    expect(loaded.map((op: { opId: string }) => op.opId)).toEqual([
      'current-task',
    ]);
    expect(countOps(opStoreDriver)).toBe(1);
  });
});
