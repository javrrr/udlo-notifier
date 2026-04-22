import { Command, Flags } from "@oclif/core";
import { fileURLToPath } from "node:url";
import { resolveConnection } from "../../auth/sf-auth.js";
import { createAwsClients, getAwsAccountId } from "../../aws/clients.js";
import { ensureLambdaRole } from "../../aws/iam.js";
import { ensureLambda } from "../../aws/lambda.js";
import { configureS3Events } from "../../aws/s3-events.js";
import { ensureSecrets } from "../../aws/secrets.js";
import { createData360Client, requireUdlo, resolveS3Connection } from "../../data-cloud/client.js";
import { deployConnectedApp, findExistingConnectedApp } from "../../salesforce/connected-app.js";
import { ensureKeyPair } from "../../salesforce/keys.js";
import { authorizeConnectedApp } from "../../salesforce/oauth.js";
import { keysDir, readState, stateFile, updateState, workspaceDir } from "../../state.js";

const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default class Setup extends Command {
  static override description = "Set up an S3-to-Data-Cloud unstructured data pipeline";

  static override flags = {
    "target-org": Flags.string({ char: "o", description: "Salesforce org alias or username" }),
    bucket: Flags.string({ char: "b", description: "S3 bucket name", required: true }),
    "object-name": Flags.string({
      char: "n",
      description: "Existing UDLO API name (must include __dll suffix, e.g. my_udlo__dll)",
      required: true,
    }),
    "s3-connection": Flags.string({
      char: "c",
      description: "Data Cloud S3 connection name (API Name or Name from Setup > Data Cloud > Connections; required once, saved to state)",
    }),
    directory: Flags.string({ char: "d", description: "S3 key prefix (no leading/trailing slashes)", default: "" }),
    "aws-region": Flags.string({ description: "AWS region", default: "us-east-1" }),
    "aws-profile": Flags.string({ description: "AWS named profile" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Setup);
    const cwd = process.cwd();
    const directory = (flags.directory ?? "").replace(/^\/+|\/+$/g, "");

    const conn = await resolveConnection(flags["target-org"]);
    this.log(`Connected to ${conn.instanceUrl} as ${conn.username}`);

    const state = readState(cwd);
    const profile = flags["aws-profile"]?.trim() || state.awsProfile;
    const aws = createAwsClients(flags["aws-region"], profile);
    const accountId = await getAwsAccountId(aws.sts);

    const suffix = state.suffix ?? Date.now().toString(36);
    updateState(cwd, {
      awsAccountId: accountId,
      awsRegion: flags["aws-region"],
      suffix,
      ...(profile ? { awsProfile: profile } : {}),
    });
    this.log(`AWS account ${accountId} (region ${flags["aws-region"]})`);

    const keys = ensureKeyPair(keysDir(cwd));
    this.log(`Keys: ${keys.pemPath}${keys.generated ? " (new)" : ""}`);

    // If we just generated fresh keys, the Connected App's stored cert (if any) is stale and JWT
    // auth will fail with invalid_client. Redeploy in that case.
    const existingKey = keys.generated ? null : state.consumerKey ?? (await findExistingConnectedApp(conn));
    let consumerKey: string;
    if (existingKey) {
      consumerKey = existingKey;
      this.log(`Connected App reused: ${consumerKey.slice(0, 12)}…`);
    } else {
      if (keys.generated && (state.consumerKey || (await findExistingConnectedApp(conn)))) {
        this.log("Fresh keys generated — redeploying Connected App with new certificate.");
      }
      consumerKey = await deployConnectedApp(conn, keys.crtPath, pluginRoot);
      this.log(`Connected App deployed: ${consumerKey.slice(0, 12)}…`);
      this.log("Opening browser — approve scopes including 'Manage Data Cloud Ingestion API data'.");
      await authorizeConnectedApp(conn.instanceUrl, consumerKey);
      this.log("OAuth consent complete.\n");
    }
    updateState(cwd, { consumerKey });

    const client = createData360Client(conn);

    const connectionName = flags["s3-connection"]?.trim() || state.s3ConnectionName;
    if (!connectionName) {
      throw new Error("--s3-connection required on first run (Setup > Data Cloud > Connections > copy Name or API Name).");
    }
    const { id: s3ConnectionId } = await resolveS3Connection(client, connectionName);
    updateState(cwd, { s3ConnectionId, s3ConnectionName: connectionName });
    this.log(`S3 connection: ${connectionName} (${s3ConnectionId})`);

    const udloName = await requireUdlo(client, flags["object-name"]);
    updateState(cwd, { udloName });
    this.log(`UDLO: ${udloName}`);

    const roleName = state.lambdaRoleName ?? `udlo-notifier-${suffix}-role`;
    const roleArn = await ensureLambdaRole(aws.iam, roleName);
    updateState(cwd, { lambdaRoleName: roleName, lambdaRoleArn: roleArn });
    this.log(`IAM role: ${roleArn}`);

    const consumerKeySecretName = state.consumerKeySecretName ?? `udlo-notifier-${suffix}-consumer-key`;
    const rsaKeySecretName = state.rsaKeySecretName ?? `udlo-notifier-${suffix}-rsa-key`;
    await ensureSecrets(aws.secrets, consumerKeySecretName, rsaKeySecretName, consumerKey, keys.pemPath, roleArn);
    updateState(cwd, { consumerKeySecretName, rsaKeySecretName });
    this.log(`Secrets: ${consumerKeySecretName}, ${rsaKeySecretName}`);

    const functionName = state.lambdaFunctionName ?? `udlo-notifier-${suffix}-fn`;
    const functionArn = await ensureLambda(
      aws.lambda,
      functionName,
      roleArn,
      conn.jwtAudienceUrl,
      conn.username,
      consumerKeySecretName,
      rsaKeySecretName,
    );
    updateState(cwd, { lambdaFunctionName: functionName, lambdaFunctionArn: functionArn });
    this.log(`Lambda: ${functionArn}`);

    await configureS3Events(aws.s3, aws.lambda, flags.bucket, directory, functionArn, accountId);
    updateState(cwd, { s3Bucket: flags.bucket, s3Directory: directory });

    this.log("\nPipeline active.");
    this.log(`  S3:        s3://${flags.bucket}/${directory}${directory ? "/" : ""}`);
    this.log(`  UDLO:      ${udloName}`);
    this.log(`  Lambda:    ${functionName}`);
    this.log(`  Workspace: ${workspaceDir(cwd)}`);
    this.log(`  State:     ${stateFile(cwd)}`);
  }
}
