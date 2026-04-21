import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, Flags } from "@oclif/core";
import { uniqueSuffix } from "../../helpers.js";
import { confirm } from "../../prompt.js";
import type { PipelineState } from "../../state.js";

const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));

function deploymentSuffix(state: PipelineState): string {
  const fromFn = state.lambdaFunctionName?.match(/^udlo-notifier-(.+)-fn$/);
  if (fromFn?.[1]) {
    return fromFn[1];
  }
  const fromRole = state.lambdaRoleName?.match(/^udlo-notifier-(.+)-role$/);
  if (fromRole?.[1]) {
    return fromRole[1];
  }
  return uniqueSuffix();
}

function normalizeDirectory(dir: string | undefined): string {
  return (dir ?? "").replace(/^\/+|\/+$/g, "");
}

export default class Setup extends Command {
  static override description = "Set up an S3-to-Data-Cloud unstructured data pipeline";

  static override flags = {
    "target-org": Flags.string({
      char: "o",
      description: "Salesforce org alias or username",
    }),
    bucket: Flags.string({
      char: "b",
      description: "S3 bucket containing unstructured data",
      required: true,
    }),
    directory: Flags.string({
      char: "d",
      description:
        "S3 key prefix within the bucket (no leading/trailing slashes). Omit or pass empty for bucket root.",
      default: "",
    }),
    "object-name": Flags.string({
      char: "n",
      description: "UDLO object name in Data Cloud (e.g. MyDocuments)",
      required: true,
    }),
    "data-space": Flags.string({
      description: "Data Cloud data space",
      default: "default",
    }),
    "aws-region": Flags.string({
      description: "AWS region for Lambda and Secrets Manager",
      default: "us-east-1",
    }),
    "auto-approve": Flags.boolean({
      description: "Skip confirmation prompts (e.g. OAuth browser step)",
    }),
    "refresh-connected-app": Flags.boolean({
      description:
        "Redeploy UDLO_Notifier Connected App metadata (e.g. after policy/certificate template changes). " +
        "Use once if Lambda JWT returns 400 and the org still has strict IP policies on the app.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Setup);
    const cwd = process.cwd();
    const directory = normalizeDirectory(flags.directory);

    const { resolveConnection } = await import("../../auth/sf-auth.js");
    const conn = await resolveConnection(flags["target-org"]);
    this.log(`Connected to ${conn.instanceUrl} as ${conn.username}`);

    const { createData360Client } = await import("../../data-cloud/client.js");
    const client = createData360Client(conn);

    const { createAwsClients } = await import("../../aws/clients.js");
    const aws = createAwsClients(flags["aws-region"]);

    const { readState, updateState } = await import("../../state.js");
    const state = readState(cwd);

    this.log("\n── AWS credentials ──");
    const { verifyAwsCredentials } = await import("../../aws/credentials.js");
    const { accountId } = await verifyAwsCredentials(aws.sts);
    updateState(cwd, { awsAccountId: accountId, awsRegion: flags["aws-region"] });
    this.log(`  Account: ${accountId}`);

    this.log("\n── RSA Keys ──");
    const { ensureKeyPair } = await import("../../salesforce/keys.js");
    const { pemPath, crtPath } = ensureKeyPair(join(pluginRoot, "keys"));
    this.log(`  Keys: ${pemPath}`);

    this.log("\n── Connected App ──");
    const { findExistingConnectedApp, deployConnectedApp } = await import("../../salesforce/connected-app.js");

    const runOAuthIfNeeded = async (key: string): Promise<void> => {
      this.log("\n── OAuth authorization ──");
      const { authorizeConnectedApp } = await import("../../salesforce/oauth.js");
      const loginBase = conn.instanceUrl.replace(/\/+$/, "");
      if (!flags["auto-approve"]) {
        const ok = await confirm("Open a browser to authorize the Connected App (required for JWT)?");
        if (!ok) {
          this.warn(
            "Skipped OAuth. Complete authorization later or JWT-based Lambda calls may fail until the app is allowed for your user.",
          );
        } else {
          await authorizeConnectedApp(loginBase, key);
        }
      } else {
        await authorizeConnectedApp(loginBase, key);
      }
    };

    let consumerKey: string;
    if (flags["refresh-connected-app"]) {
      this.log("  Redeploying Connected App (metadata + certificate from keys/)…");
      consumerKey = await deployConnectedApp(conn, crtPath, pluginRoot);
      updateState(cwd, { consumerKey });
      this.log(`  Consumer key: ${consumerKey.slice(0, 12)}…`);
      await runOAuthIfNeeded(consumerKey);
    } else {
      const existing = state.consumerKey ?? (await findExistingConnectedApp(conn, pluginRoot));
      if (existing) {
        consumerKey = existing;
        this.log(`  Reusing consumer key: ${consumerKey.slice(0, 12)}…`);
        updateState(cwd, { consumerKey });
      } else {
        consumerKey = await deployConnectedApp(conn, crtPath, pluginRoot);
        updateState(cwd, { consumerKey });
        this.log(`  Deployed. Consumer key: ${consumerKey.slice(0, 12)}…`);
        await runOAuthIfNeeded(consumerKey);
      }
    }

    this.log("\n── S3 connection ──");
    const { requireS3Connection } = await import("../../data-cloud/connection.js");
    const s3Connection = await requireS3Connection(client, flags.bucket);
    updateState(cwd, { s3ConnectionId: s3Connection.id });
    this.log(`  ${s3Connection.label} (${s3Connection.id})`);

    this.log("\n── UDLO ──");
    const { createUdlo } = await import("../../data-cloud/udlo.js");
    const { udloName, udmoName } = await createUdlo(
      client,
      s3Connection.id,
      flags["object-name"],
      directory,
      flags["data-space"],
    );
    updateState(cwd, { udloName, udmoName });
    this.log(`  UDLO: ${udloName} (DMO name tracked as ${udmoName})`);

    const suffix = deploymentSuffix(state);

    this.log("\n── Lambda IAM role ──");
    const { ensureLambdaRole } = await import("../../aws/iam.js");
    const roleName = state.lambdaRoleName ?? `udlo-notifier-${suffix}-role`;
    const roleArn = await ensureLambdaRole(aws.iam, roleName);
    updateState(cwd, { lambdaRoleName: roleName, lambdaRoleArn: roleArn });
    this.log(`  ${roleArn}`);

    this.log("\n── Secrets Manager ──");
    const { ensureSecrets } = await import("../../aws/secrets.js");
    const consumerKeySecretName = state.consumerKeySecretName ?? `udlo-notifier-${suffix}-consumer-key`;
    const rsaKeySecretName = state.rsaKeySecretName ?? `udlo-notifier-${suffix}-rsa-key`;
    const secrets = await ensureSecrets(
      aws.secretsManager,
      consumerKeySecretName,
      rsaKeySecretName,
      consumerKey,
      pemPath,
      roleArn,
      accountId,
    );
    updateState(cwd, {
      consumerKeySecretName,
      consumerKeySecretArn: secrets.consumerKeySecretArn,
      rsaKeySecretName,
      rsaKeySecretArn: secrets.rsaKeySecretArn,
    });
    this.log(`  ${consumerKeySecretName}, ${rsaKeySecretName}`);

    this.log("\n── Lambda function ──");
    const { ensureLambda } = await import("../../aws/lambda.js");
    const functionName = state.lambdaFunctionName ?? `udlo-notifier-${suffix}-fn`;
    const sfOauthBaseUrl =
      process.env.UDLO_SF_JWT_AUDIENCE?.trim() || conn.jwtAudienceUrl;
    const functionArn = await ensureLambda(
      aws.lambda,
      functionName,
      roleArn,
      sfOauthBaseUrl,
      conn.username,
      consumerKeySecretName,
      rsaKeySecretName,
    );
    updateState(cwd, { lambdaFunctionName: functionName, lambdaFunctionArn: functionArn });
    this.log(`  ${functionArn}`);

    this.log("\n── S3 event notifications ──");
    const { configureS3Events } = await import("../../aws/s3-events.js");
    await configureS3Events(aws.s3, aws.lambda, flags.bucket, directory, functionArn, accountId);
    updateState(cwd, { s3Bucket: flags.bucket, s3Directory: directory });

    this.log("\n── Pipeline active ──");
    this.log(`  S3: s3://${flags.bucket}/${directory}/`);
    this.log(`  UDLO: ${udloName}`);
    this.log(`  Lambda: ${functionName}`);
    this.log(`  State: ${join(cwd, ".udlo-state.json")}`);
  }
}
