import type { Data360Client } from "data-360-sdk";

export interface S3ConnectionSummary {
  id: string;
  name: string;
  label: string;
}

/** Connector types used for Amazon S3–style storage in Data Cloud (org-dependent). */
const S3_CONNECTOR_TYPES = ["AwsS3", "AmazonS3", "S3"] as const;

function summarizeConnection(conn: unknown): S3ConnectionSummary | null {
  const c = conn as { id?: string; name?: string; label?: string };
  if (!c.id) {
    return null;
  }
  return {
    id: c.id,
    name: c.name ?? c.id,
    label: c.label ?? c.name ?? c.id,
  };
}

function connectionJsonMentionsBucket(conn: unknown, bucketName: string): boolean {
  const needle = bucketName.toLowerCase();
  return JSON.stringify(conn).toLowerCase().includes(needle);
}

export async function findS3Connection(
  client: Data360Client,
  bucketName?: string,
): Promise<S3ConnectionSummary | null> {
  for (const connectorType of S3_CONNECTOR_TYPES) {
    let page: Awaited<ReturnType<Data360Client["connections"]["list"]>>;
    try {
      page = await client.connections.list({ batchSize: 100, connectorType });
    } catch {
      continue;
    }
    for (const conn of page.connections ?? []) {
      if (bucketName && !connectionJsonMentionsBucket(conn, bucketName)) {
        continue;
      }
      const summary = summarizeConnection(conn);
      if (summary) {
        return summary;
      }
    }
  }
  return null;
}

export async function requireS3Connection(
  client: Data360Client,
  bucketName?: string,
): Promise<S3ConnectionSummary> {
  const found = await findS3Connection(client, bucketName);
  if (!found) {
    const bucketHint = bucketName
      ? ` The connection must reference bucket "${bucketName}" (same as udlo setup -b).`
      : "";
    throw new Error(
      "No S3 connection found in Data Cloud. This tool does not create that connection — only AWS Lambda/IAM later." +
        bucketHint +
        "\n  In the org: Setup > Data Cloud > Connections > New > Amazon S3 (use AWS credentials or an IAM role as the wizard requires).\n" +
        "Then re-run this command.",
    );
  }
  return found;
}
