import type { Data360Client, DataLakeObjectInputRepresentation } from "data-360-sdk";
import { sleep } from "../helpers.js";

export interface UdloResult {
  udloName: string;
  udmoName: string;
}

const UI_POLL_INTERVAL_MS = 3000;
const UI_POLL_MAX_MS = 600_000;

/** Data Cloud UDLO directory paths expect a trailing slash (e.g. `afd360/`), not `afd360`. */
export function udloDirectoryPathForDataCloud(relativeDirectory: string): string {
  const d = relativeDirectory.trim();
  if (d === "") {
    return "";
  }
  return d.endsWith("/") ? d : `${d}/`;
}

async function findUdloByDeveloperName(
  client: Data360Client,
  objectName: string,
): Promise<UdloResult | null> {
  const want = objectName.toLowerCase();
  for await (const dlo of client.dataLakeObjects.listAll({ batchSize: 100 })) {
    const n = dlo.name?.toLowerCase();
    const l = dlo.label?.toLowerCase();
    if (n === want || l === want) {
      const udloName = dlo.name ?? objectName;
      return { udloName, udmoName: udloName };
    }
  }
  return null;
}

function buildCreatePayload(
  objectName: string,
  connectionId: string,
  s3Directory: string,
  dataSpace: string,
): DataLakeObjectInputRepresentation {
  const extended = {
    name: objectName,
    label: objectName,
    category: "Other",
    dataspaceInfo: [{ name: dataSpace }],
    connectionId,
    directories: [{ path: s3Directory }],
  };
  return extended as unknown as DataLakeObjectInputRepresentation;
}

async function waitForUdloAfterUiFailure(
  client: Data360Client,
  objectName: string,
  s3Directory: string,
  apiError: string,
): Promise<UdloResult> {
  const help = [
    "Automatic UDLO creation via API failed:",
    apiError,
    "",
    "Create the UDLO in Data Cloud UI:",
    "  Data Cloud > Data Lake Objects > New > From External Files > Amazon S3",
    `  Object name: ${objectName}`,
    `  Directory: ${s3Directory}`,
    "",
    `Polling for up to ${UI_POLL_MAX_MS / 60_000} minutes for "${objectName}" to appear…`,
  ].join("\n");
  console.log(help);

  const deadline = Date.now() + UI_POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(UI_POLL_INTERVAL_MS);
    const found = await findUdloByDeveloperName(client, objectName);
    if (found) {
      return found;
    }
  }
  throw new Error(
    `UDLO "${objectName}" did not appear after API error and UI polling. Create it in Data Cloud, then retry.`,
  );
}

export async function createUdlo(
  client: Data360Client,
  connectionId: string,
  objectName: string,
  s3Directory: string,
  dataSpace = "default",
): Promise<UdloResult> {
  const existing = await findUdloByDeveloperName(client, objectName);
  if (existing) {
    return existing;
  }

  const directoryPath = udloDirectoryPathForDataCloud(s3Directory);
  const body = buildCreatePayload(objectName, connectionId, directoryPath, dataSpace);
  try {
    const created = await client.dataLakeObjects.create(body);
    const udloName = created.name ?? objectName;
    return { udloName, udmoName: udloName };
  } catch (e) {
    const apiError = e instanceof Error ? e.message : String(e);
    return waitForUdloAfterUiFailure(client, objectName, directoryPath, apiError);
  }
}

export async function destroyUdlo(client: Data360Client, udloName: string): Promise<void> {
  try {
    await client.dataLakeObjects.delete(udloName);
  } catch {
    // Best-effort teardown if object is already gone
  }
}
