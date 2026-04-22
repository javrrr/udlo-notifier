import { AuthInfo, ConfigAggregator, Connection, Org, StateAggregator } from "@salesforce/core";

export interface SfConnection {
  accessToken: string;
  instanceUrl: string;
  username: string;
  jwtAudienceUrl: string;
}

export async function resolveConnection(targetOrg?: string): Promise<SfConnection> {
  let alias = targetOrg;
  if (!alias) {
    const cfg = await ConfigAggregator.create();
    const def = cfg.getPropertyValue("target-org");
    if (typeof def !== "string" || !def) {
      throw new Error("No target org. Pass --target-org <alias> or run: sf config set target-org=<alias>");
    }
    alias = def;
  }

  const aliases = (await StateAggregator.getInstance()).aliases;
  const username = aliases.getUsername(alias) ?? alias;

  const authInfo = await AuthInfo.create({ username });
  const connection = await Connection.create({ authInfo });
  const fields = authInfo.getFields() as Record<string, unknown>;

  const F = Org.Fields;
  const sandbox = fields[F.IS_SANDBOX] === true || fields[F.IS_SCRATCH] === true;
  const loginUrl = String(fields.loginUrl ?? "").toLowerCase();
  const jwtAudienceUrl =
    sandbox || loginUrl.includes("test.salesforce.com")
      ? "https://test.salesforce.com"
      : "https://login.salesforce.com";

  return {
    accessToken: connection.accessToken!,
    instanceUrl: connection.instanceUrl,
    username: authInfo.getUsername(),
    jwtAudienceUrl,
  };
}
