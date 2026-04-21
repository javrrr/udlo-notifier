export interface SfConnection {
  accessToken: string;
  instanceUrl: string;
  username: string;
}

const SF_CORE_MODULE = "@salesforce/core";

export async function resolveConnection(targetOrg?: string): Promise<SfConnection> {
  const sfCore: any = await import(SF_CORE_MODULE).catch(() => {
    throw new Error(
      "@salesforce/core is required for org connectivity. " +
        "Install it with: npm add -D @salesforce/core",
    );
  });

  const { AuthInfo, Connection, ConfigAggregator, StateAggregator } = sfCore;

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

  return {
    accessToken: connection.accessToken!,
    instanceUrl: connection.instanceUrl,
    username: authInfo.getUsername(),
  };
}
