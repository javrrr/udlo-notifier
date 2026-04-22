export interface SfConnection {
  accessToken: string;
  instanceUrl: string;
  username: string;
  /** Host for JWT `aud` (login or test), not the org My Domain URL. */
  jwtAudienceUrl: string;
}

const SF_CORE_MODULE = "@salesforce/core";

function resolveJwtAudienceUrl(Org: any, authFields: Record<string, unknown>): string {
  const F = Org?.Fields;
  const isSandboxLike = Boolean(
    F && (authFields[F.IS_SANDBOX] === true || authFields[F.IS_SCRATCH] === true),
  );
  if (isSandboxLike) {
    return "https://test.salesforce.com";
  }
  const loginUrl = String(authFields.loginUrl ?? "").toLowerCase();
  if (loginUrl.includes("test.salesforce.com")) {
    return "https://test.salesforce.com";
  }
  return "https://login.salesforce.com";
}

export async function resolveConnection(targetOrg?: string): Promise<SfConnection> {
  const sfCore: any = await import(SF_CORE_MODULE).catch(() => {
    throw new Error(
      "@salesforce/core is required for org connectivity. " +
        "Install this package with its dependencies (see package.json), or run: npm add @salesforce/core",
    );
  });

  const { AuthInfo, Connection, ConfigAggregator, StateAggregator, Org } = sfCore;

  let username: string;

  if (targetOrg) {
    const stateAgg = await StateAggregator.getInstance();
    const resolved = stateAgg.aliases.getUsername(targetOrg);
    username = resolved ?? targetOrg;
  } else {
    const configAggregator = await ConfigAggregator.create();
    const defaultOrg = configAggregator.getPropertyValue("target-org");
    if (!defaultOrg || typeof defaultOrg !== "string") {
      throw new Error(
        "No target org specified and no default org set. " +
          "Use --target-org or run: sf config set target-org=<alias>",
      );
    }
    const stateAgg = await StateAggregator.getInstance();
    const resolved = stateAgg.aliases.getUsername(defaultOrg);
    username = resolved ?? defaultOrg;
  }

  const authInfo = await AuthInfo.create({ username });
  const connection = await Connection.create({ authInfo });
  const authFields = authInfo.getFields() as Record<string, unknown>;
  const jwtAudienceUrl = resolveJwtAudienceUrl(Org, authFields);

  return {
    accessToken: connection.accessToken!,
    instanceUrl: connection.instanceUrl,
    username: authInfo.getUsername(),
    jwtAudienceUrl,
  };
}
