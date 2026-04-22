import { Data360Client } from "data-360-sdk";
import type { SfConnection } from "../auth/sf-auth.js";

export function createData360Client(conn: SfConnection): Data360Client {
  return new Data360Client({
    instanceUrl: `${conn.instanceUrl}/services/data/v66.0`,
    auth: { type: "static", accessToken: conn.accessToken },
    timeout: 60_000,
    maxRetries: 2,
  });
}

/**
 * Strict match on the UDLO API name (e.g. `afd360_s3__dll`). Uses list rather than get()
 * because the get endpoint is inconsistent about which identifier form it accepts.
 */
export async function requireUdlo(client: Data360Client, name: string): Promise<string> {
  for await (const dlo of client.dataLakeObjects.listAll({ batchSize: 200 })) {
    if (dlo.name === name) return dlo.name;
  }
  throw new Error(
    `No Data Lake Object named "${name}" in Data Cloud. ` +
      "Pass the exact API name including the __dll suffix (e.g. afd360_s3__dll) via --object-name. " +
      "Find it in Data Cloud > Data Lake Objects (API Name column). " +
      "Create the UDLO first if it doesn't exist: New > From External Files > Amazon S3.",
  );
}

export interface ResolvedS3Connection {
  id: string;
  name: string;
}

type ConnRec = { id?: string; devName?: string; name?: string; label?: string };

const S3_TYPES = ["AmazonS3", "AwsS3", "S3"] as const;

function errorDetail(e: unknown): string {
  const err = e as { body?: unknown; message?: string };
  if (err?.body) {
    try {
      return typeof err.body === "string" ? err.body : JSON.stringify(err.body);
    } catch {
      /* fall through */
    }
  }
  return err?.message ?? String(e);
}

/**
 * Resolves an Amazon S3 connection by the name shown in the Data Cloud UI
 * (Setup > Data Cloud > Connections). Matches against devName (API Name column)
 * or label (Name column). Tries multiple connectorType values since orgs vary.
 */
export async function resolveS3Connection(client: Data360Client, name: string): Promise<ResolvedS3Connection> {
  const want = name.trim();
  const lastErrors: string[] = [];
  const seen: ConnRec[] = [];

  for (const connectorType of S3_TYPES) {
    try {
      const page = await client.connections.list({ connectorType, batchSize: 200 });
      const conns = (page.connections ?? []) as ConnRec[];
      seen.push(...conns);
      const match = conns.find((c) => c.devName === want || c.name === want || c.label === want);
      if (match?.id) return { id: match.id, name: match.devName ?? match.name ?? match.label ?? want };
    } catch (e) {
      lastErrors.push(`${connectorType}: ${errorDetail(e)}`);
    }
  }

  if (seen.length === 0) {
    throw new Error(
      `Could not list Data Cloud S3 connections. The org may not be Data Cloud–enabled, or the user lacks permission. Tried ${S3_TYPES.join(", ")}.\n` +
        lastErrors.map((l) => `  ${l}`).join("\n"),
    );
  }

  const available = seen
    .map((c) => c.devName ?? c.name ?? c.label)
    .filter((v): v is string => !!v)
    .slice(0, 10);
  throw new Error(
    `No S3 connection named "${want}" in Data Cloud. ` +
      `Pass --s3-connection with one of: ${available.join(", ")}` +
      (seen.length > available.length ? `, … (${seen.length} total)` : ""),
  );
}
