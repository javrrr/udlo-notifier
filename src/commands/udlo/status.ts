import { Command, Flags } from "@oclif/core";

function row(label: string, status: string, detail: string): void {
  process.stdout.write(`${label.padEnd(22)} ${status.padEnd(8)} ${detail}\n`);
}

export default class Status extends Command {
  static override description = "Check health of the UDLO pipeline (from .udlo-state.json)";

  static override flags = {
    "target-org": Flags.string({ char: "o", description: "Salesforce org alias or username" }),
    "aws-region": Flags.string({ description: "AWS region", default: "us-east-1" }),
    "aws-profile": Flags.string({
      description: "AWS named profile; optional. Overrides .udlo-state.json awsProfile when set.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const cwd = process.cwd();

    const { readState } = await import("../../state.js");
    const state = readState(cwd);

    this.log("Resource               Status   Detail");
    this.log("────────────────────── ──────── ─────────────────────────────────────────");

    if (!state.lambdaFunctionName && !state.s3Bucket) {
      this.log("(No state — run udlo-notifier udlo setup first)");
      return;
    }

    const { createAwsClients } = await import("../../aws/clients.js");
    const awsProfile = flags["aws-profile"]?.trim() || state.awsProfile;
    const aws = createAwsClients(flags["aws-region"], { profile: awsProfile });

    const { resolveConnection } = await import("../../auth/sf-auth.js");
    const { createData360Client } = await import("../../data-cloud/client.js");
    const conn = await resolveConnection(flags["target-org"]);
    const client = createData360Client(conn);

    try {
      const { findExistingConnectedApp } = await import("../../salesforce/connected-app.js");
      const { fileURLToPath } = await import("node:url");
      const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));
      const ck = await findExistingConnectedApp(conn, pluginRoot);
      row("Connected App", ck ? "OK" : "?", ck ? "UDLO_Notifier (consumer key present)" : "Not found / not queryable");
    } catch {
      row("Connected App", "?", "Could not verify");
    }

    if (state.s3ConnectionId) {
      try {
        await client.connections.get(state.s3ConnectionId);
        row("S3 connection", "OK", state.s3ConnectionId);
      } catch {
        row("S3 connection", "WARN", `${state.s3ConnectionId} (get failed)`);
      }
    } else {
      row("S3 connection", "—", "Not in state");
    }

    if (state.udloName) {
      try {
        await client.dataLakeObjects.get(state.udloName);
        row("UDLO", "OK", state.udloName);
      } catch {
        row("UDLO", "WARN", `${state.udloName} (get failed)`);
      }
    } else {
      row("UDLO", "—", "Not in state");
    }

    if (state.lambdaFunctionName) {
      try {
        const { GetFunctionCommand } = await import("@aws-sdk/client-lambda");
        const cfg = await aws.lambda.send(
          new GetFunctionCommand({ FunctionName: state.lambdaFunctionName }),
        );
        row("Lambda", cfg.Configuration?.State === "Active" ? "OK" : "?", state.lambdaFunctionName);
      } catch {
        row("Lambda", "MISSING", state.lambdaFunctionName);
      }
    } else {
      row("Lambda", "—", "Not in state");
    }

    if (state.s3Bucket && state.lambdaFunctionArn) {
      try {
        const { GetBucketNotificationConfigurationCommand } = await import("@aws-sdk/client-s3");
        const n = await aws.s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: state.s3Bucket }));
        const has = (n.LambdaFunctionConfigurations ?? []).some(
          (c) => c.LambdaFunctionArn === state.lambdaFunctionArn,
        );
        row("S3 → Lambda", has ? "OK" : "WARN", `s3://${state.s3Bucket}/${state.s3Directory ?? ""}/`);
      } catch {
        row("S3 → Lambda", "?", state.s3Bucket);
      }
    } else {
      row("S3 → Lambda", "—", "Incomplete state");
    }

    if (state.consumerKeySecretName) {
      try {
        const { DescribeSecretCommand } = await import("@aws-sdk/client-secrets-manager");
        await aws.secretsManager.send(
          new DescribeSecretCommand({ SecretId: state.consumerKeySecretName }),
        );
        row("Secrets", "OK", "consumer key + RSA (if named in state)");
      } catch {
        row("Secrets", "?", state.consumerKeySecretName);
      }
    } else {
      row("Secrets", "—", "Not in state");
    }

    if (state.lambdaRoleName) {
      try {
        const { GetRoleCommand } = await import("@aws-sdk/client-iam");
        await aws.iam.send(new GetRoleCommand({ RoleName: state.lambdaRoleName }));
        row("IAM role", "OK", state.lambdaRoleName);
      } catch {
        row("IAM role", "MISSING", state.lambdaRoleName);
      }
    } else {
      row("IAM role", "—", "Not in state");
    }
  }
}
