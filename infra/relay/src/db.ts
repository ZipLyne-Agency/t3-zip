import type { PgClient } from "@effect/sql-pg/PgClient";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { relayDatabaseMode } from "./dbConfig.ts";

export class RelayDb extends Context.Service<
  RelayDb,
  EffectPgDatabase & {
    readonly $client: PgClient;
  }
>()("t3code-relay/db/RelayDb") {}

export class RelayTransactions extends Context.Service<
  RelayTransactions,
  {
    readonly withTransaction: RelayDb["Service"]["$client"]["withTransaction"];
  }
>()("t3code-relay/db/RelayTransactions") {
  static readonly layer = Layer.effect(
    RelayTransactions,
    Effect.gen(function* () {
      const db = yield* RelayDb;
      return RelayTransactions.of({
        withTransaction: db.$client.withTransaction,
      });
    }),
  );
}

/**
 * An externally managed Postgres (for example Neon) used in place of PlanetScale when
 * `RELAY_EXTERNAL_DATABASE_URL` is set. The stack then creates no database resources: the
 * migrations in `migrations/postgres` are applied by `scripts/migrate-external-database.ts`
 * before deploy, and Hyperdrive connects straight to this origin.
 */
const ExternalDatabaseUrl = Config.Redacted("RELAY_EXTERNAL_DATABASE_URL").pipe(Config.option);

export const externalDatabaseOrigin = (url: Redacted.Redacted<string>) => {
  const parsed = new URL(Redacted.value(url));
  const scheme = parsed.protocol.replace(/:$/, "");
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new Error(`RELAY_EXTERNAL_DATABASE_URL must be a postgres URL, got "${scheme}:"`);
  }
  return {
    scheme: scheme as "postgres" | "postgresql",
    host: parsed.hostname,
    ...(parsed.port ? { port: Number(parsed.port) } : {}),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    user: decodeURIComponent(parsed.username),
    password: Redacted.make(decodeURIComponent(parsed.password)),
  };
};

export const PlanetscaleDatabase = Effect.gen(function* () {
  const external = yield* ExternalDatabaseUrl;
  if (Option.isSome(external)) {
    const origin = externalDatabaseOrigin(external.value);
    return {
      branch: undefined,
      database: { name: origin.database },
      runtimeRole: { origin },
    };
  }
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("RelaySchema", {
    schema: "./src/persistence/schema.ts",
    out: "./migrations/postgres",
    dialect: "postgres",
  });

  const mode = relayDatabaseMode(stage);
  const database =
    mode === "shared-database"
      ? yield* Planetscale.PostgresDatabase("RelayPostgresDatabase", {
          name: "t3coderelay",
          region: { slug: "us-west" },
          clusterSize: "PS_160",
          migrations: { dir: schema.out, table: "relay_migrations" },
          replicas: 2,
        }).pipe(RemovalPolicy.retain())
      : yield* Planetscale.PostgresDatabase.ref("RelayPostgresDatabase", {
          stage: "prod",
        });
  const branch =
    mode === "stage-branch"
      ? yield* Planetscale.PostgresBranch("RelayPostgresBranch", {
          database,
          migrations: { dir: schema.out, table: "relay_migrations" },
        })
      : undefined;

  const runtimeRole = yield* Planetscale.PostgresRole("RelayPostgresRuntimeRole", {
    database,
    ...(branch ? { branch } : {}),
    inheritedRoles: ["pg_read_all_data", "pg_write_all_data"],
  });

  return { branch, database, runtimeRole };
});

export const RelayHyperdrive = Effect.gen(function* () {
  const { runtimeRole } = yield* PlanetscaleDatabase;
  return yield* Cloudflare.Hyperdrive.Connection("RelayHyperdrive", {
    origin: runtimeRole.origin,
    caching: {
      disabled: true,
    },
    originConnectionLimit: 40,
  });
});
