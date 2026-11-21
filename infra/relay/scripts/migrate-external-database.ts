/**
 * Applies `migrations/postgres` to the external Postgres named by RELAY_EXTERNAL_DATABASE_URL
 * (see `src/db.ts`). It uses the same Alchemy migration runner and `relay_migrations` table as
 * the PlanetScale path, so either database can later take over the other's history.
 *
 *   RELAY_EXTERNAL_DATABASE_URL=postgresql://... node scripts/migrate-external-database.ts
 */
import * as NodeModule from "node:module";
import * as NodeURL from "node:url";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const MIGRATIONS_TABLE = "relay_migrations";

class MigrationFailed extends Schema.TaggedError<MigrationFailed>()("MigrationFailed", {
  message: Schema.String,
}) {}

/** The runner's executor handle; this script only passes it through. */
interface SqlExecutor {
  readonly query: unknown;
}

interface RunnerError {
  readonly message: string;
}

type RunnerServices = FileSystem.FileSystem | Path.Path;

/** The part of `@alchemy.run/sql/Migrations` this script calls. */
interface MigrationsModule {
  readonly runMigrations: (options: {
    readonly input: { readonly dir: string; readonly table: string };
    readonly stamped: { readonly table: string };
    readonly withExecutor: (
      apply: (executor: SqlExecutor) => Effect.Effect<void, RunnerError, RunnerServices>,
    ) => Effect.Effect<void, RunnerError, RunnerServices>;
  }) => Effect.Effect<{ readonly hashes: Record<string, string> }, RunnerError, RunnerServices>;
  readonly withPgExecutor: (
    config: {
      readonly connectionString: string;
      readonly ssl: { readonly rejectUnauthorized: boolean };
    },
    use: (executor: SqlExecutor) => Effect.Effect<void, RunnerError, RunnerServices>,
  ) => Effect.Effect<void, RunnerError, RunnerServices>;
}

// `@alchemy.run/sql` is the runner `@alchemy.run/planetscale` migrates with; it is not a direct
// dependency of this package, so resolve it through the provider that owns it.
const loadMigrations = Effect.tryPromise({
  try: async () => {
    const require = NodeModule.createRequire(import.meta.url);
    const fromPlanetscale = NodeModule.createRequire(require.resolve("@alchemy.run/planetscale"));
    const entry = fromPlanetscale.resolve("@alchemy.run/sql/Migrations");
    return (await import(NodeURL.pathToFileURL(entry).href)) as MigrationsModule;
  },
  catch: (cause) =>
    new MigrationFailed({ message: `Loading the migration runner: ${String(cause)}` }),
});

const withoutSslParams = (url: string) => {
  const parsed = new URL(url);
  for (const key of ["sslmode", "channel_binding", "sslrootcert"]) parsed.searchParams.delete(key);
  return parsed.toString();
};

const main = Effect.gen(function* () {
  const path = yield* Path.Path;
  const url = yield* Config.Redacted("RELAY_EXTERNAL_DATABASE_URL");
  const dir = path.join(
    yield* path.fromFileUrl(new URL("..", import.meta.url)),
    "migrations",
    "postgres",
  );
  const migrations = yield* loadMigrations;
  const run = yield* migrations
    .runMigrations({
      input: { dir, table: MIGRATIONS_TABLE },
      stamped: { table: MIGRATIONS_TABLE },
      withExecutor: (apply) =>
        migrations.withPgExecutor(
          {
            connectionString: withoutSslParams(Redacted.value(url)),
            ssl: { rejectUnauthorized: true },
          },
          apply,
        ),
    })
    .pipe(Effect.mapError((error) => new MigrationFailed({ message: error.message })));
  yield* Console.log(
    `Migrations in ${MIGRATIONS_TABLE} are current (${Object.keys(run.hashes).length} files).`,
  );
});

NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
