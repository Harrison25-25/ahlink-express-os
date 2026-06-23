import { createEmptyDatabase, ensureDatabaseShape } from "./store.js";

export class PostgresStateStore {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this._pool = null;
    this.validateConnectionString();
  }

  validateConnectionString() {
    let parsed;
    try {
      parsed = new URL(this.connectionString);
    } catch {
      throw new Error("DATABASE_URL is not a valid PostgreSQL connection string. Copy the real connection string from Neon.");
    }
    const placeholders = ["USER", "PASSWORD", "HOST", "DBNAME"];
    const hasPlaceholder = placeholders.some((value) =>
      decodeURIComponent(this.connectionString).includes(value)
    );
    if (hasPlaceholder || parsed.hostname.toUpperCase() === "HOST") {
      throw new Error("DATABASE_URL still contains template placeholders. Replace USER, PASSWORD, HOST, and DBNAME with the real Neon connection string.");
    }
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      throw new Error("DATABASE_URL must start with postgresql:// or postgres://.");
    }
  }

  async pool() {
    if (!this._pool) {
      const { Pool } = await import("pg");
      this._pool = new Pool({
        connectionString: this.connectionString,
        ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }
      });
    }
    return this._pool;
  }

  async ready() {
    const pool = await this.pool();
    await pool.query(`
      create table if not exists app_state (
        id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query(
      `insert into app_state (id, data)
       values ($1, $2::jsonb)
       on conflict (id) do nothing`,
      ["default", JSON.stringify(createEmptyDatabase())]
    );
  }

  async read() {
    const pool = await this.pool();
    const result = await pool.query("select data from app_state where id = $1", ["default"]);
    if (!result.rows[0]) return createEmptyDatabase();
    return ensureDatabaseShape(result.rows[0].data);
  }

  async write(database, client = null) {
    const executor = client || await this.pool();
    await executor.query(
      `update app_state
       set data = $2::jsonb, updated_at = now()
       where id = $1`,
      ["default", JSON.stringify(ensureDatabaseShape(database))]
    );
  }

  async transaction(callback) {
    const pool = await this.pool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query("select data from app_state where id = $1 for update", ["default"]);
      const database = ensureDatabaseShape(result.rows[0]?.data || createEmptyDatabase());
      const callbackResult = await callback(database);
      await this.write(database, client);
      await client.query("commit");
      return callbackResult;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
