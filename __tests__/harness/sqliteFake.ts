/**
 * installRealSqlite — back the @op-engineering/op-sqlite boundary with a REAL in-memory sqlite engine
 * (node:sqlite DatabaseSync), so ragDatabase / RAG / embeddings / search_knowledge_base run their actual
 * SQL — the "fake sqlite does the hard work" tier, not the dumb global op-sqlite mock (which returns
 * empty and hides real behavior). The DB is PREFER-REAL, above the fake line.
 *
 * Call at the top of a test body; it jest.resetModules() + doMock('@op-engineering/op-sqlite'), then the
 * test require()s the rag modules so they open the real :memory: db. Each install = a fresh empty db.
 */
export function installRealSqlite(setupSql?: string): void {
  jest.resetModules();
  doMockRealSqlite(setupSql);
}

/**
 * The op-sqlite doMock WITHOUT jest.resetModules — so it can COMPOSE with another boundary installer that
 * already reset modules (e.g. installNativeBoundary for a mounted-screen RAG test). Call AFTER that installer,
 * before requiring the rag modules. installRealSqlite = resetModules + this.
 */
export function createRealSqliteModule(setupSql?: string) {
  const databases: any[] = [];
  return (() => {
    const { DatabaseSync } = require('node:sqlite');

    const wrap = (db: any) => ({
      executeSync: (sql: string, params: unknown[] = []) => {
        const bind = (params ?? []).map(p =>
          // op-sqlite accepts ArrayBuffer for BLOBs; node:sqlite wants a Uint8Array/Buffer. Use a
          // realm-safe check (Object.prototype.toString) because a composed harness (installNativeBoundary
          // + doMockRealSqlite) can hand us an ArrayBuffer from a different realm where `instanceof` fails.
          p instanceof ArrayBuffer ||
          Object.prototype.toString.call(p) === '[object ArrayBuffer]'
            ? new Uint8Array(p as ArrayBuffer)
            : p,
        );
        // Transaction / DDL control statements: no params, run via exec.
        if (
          /^\s*(BEGIN|COMMIT|ROLLBACK|CREATE|PRAGMA|DROP)/i.test(sql) &&
          bind.length === 0
        ) {
          db.exec(sql);
          return { rows: [], insertId: undefined, rowsAffected: 0 };
        }
        const stmt = db.prepare(sql);
        if (/^\s*SELECT/i.test(sql)) {
          const rows = stmt.all(...bind);
          return { rows, insertId: undefined, rowsAffected: 0 };
        }
        const info = stmt.run(...bind);
        return {
          rows: [],
          insertId:
            info.lastInsertRowid != null
              ? Number(info.lastInsertRowid)
              : undefined,
          rowsAffected: Number(info.changes ?? 0),
        };
      },
      execute: async function (this: any, sql: string, params: unknown[] = []) {
        return this.executeSync(sql, params);
      },
      close: () => db.close(),
      delete: () => {},
    });

    return {
      open: () => {
        const db = new DatabaseSync(':memory:');
        databases.push(db);
        if (setupSql) db.exec(setupSql);
        return wrap(db);
      },
      reset: () => {
        for (const db of databases) {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
          for (const {name} of tables) db.exec(`DELETE FROM "${name}"`);
        }
      },
    };
  })();
}

export function doMockRealSqlite(setupSql?: string): void {
  jest.doMock('@op-engineering/op-sqlite', () => createRealSqliteModule(setupSql));
}
