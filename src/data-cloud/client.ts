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
