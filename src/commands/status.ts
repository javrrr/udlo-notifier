import { Command, Flags } from "@oclif/core";
import { GetRoleCommand } from "@aws-sdk/client-iam";
import { GetFunctionCommand } from "@aws-sdk/client-lambda";
import { GetBucketNotificationConfigurationCommand } from "@aws-sdk/client-s3";
import { DescribeSecretCommand } from "@aws-sdk/client-secrets-manager";
import { createAwsClients } from "../aws/clients.js";
import { readState } from "../state.js";

export default class Status extends Command {
  static override description = "Show health of the UDLO pipeline";

  static override flags = {
    "aws-region": Flags.string({ description: "AWS region (defaults to saved value from setup)" }),
    "aws-profile": Flags.string({ description: "AWS named profile" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Status);
    const state = readState(process.cwd());

    if (!state.lambdaFunctionName && !state.s3Bucket) {
      this.log("No state — run `udlo-notifier setup` first.");
      return;
    }

    const region = flags["aws-region"]?.trim() || state.awsRegion;
    if (!region) {
      this.error("No AWS region. Pass --aws-region or run setup first so it is saved to state.");
    }
    const aws = createAwsClients(region, flags["aws-profile"]?.trim() || state.awsProfile);

    const row = (label: string, status: string, detail: string): void => {
      this.log(`${label.padEnd(14)} ${status.padEnd(8)} ${detail}`);
    };

    const probe = async (label: string, detail: string, check: () => Promise<unknown>): Promise<void> => {
      try {
        await check();
        row(label, "OK", detail);
      } catch {
        row(label, "MISSING", detail);
      }
    };

    row("Resource", "Status", "Detail");
    row("────────", "──────", "──────");

    if (state.lambdaRoleName) {
      await probe("IAM role", state.lambdaRoleName, () => aws.iam.send(new GetRoleCommand({ RoleName: state.lambdaRoleName! })));
    }
    if (state.consumerKeySecretName) {
      await probe("Secrets", state.consumerKeySecretName, () =>
        aws.secrets.send(new DescribeSecretCommand({ SecretId: state.consumerKeySecretName! })),
      );
    }
    if (state.lambdaFunctionName) {
      await probe("Lambda", state.lambdaFunctionName, () =>
        aws.lambda.send(new GetFunctionCommand({ FunctionName: state.lambdaFunctionName! })),
      );
    }
    if (state.s3Bucket && state.lambdaFunctionArn) {
      try {
        const n = await aws.s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: state.s3Bucket }));
        const wired = (n.LambdaFunctionConfigurations ?? []).some((c) => c.LambdaFunctionArn === state.lambdaFunctionArn);
        row("S3 → Lambda", wired ? "OK" : "MISSING", `s3://${state.s3Bucket}/${state.s3Directory ?? ""}`);
      } catch {
        row("S3 → Lambda", "ERROR", state.s3Bucket);
      }
    }
    if (state.udloName) row("UDLO", "—", state.udloName);
    if (state.s3ConnectionName) row("S3 connection", "—", `${state.s3ConnectionName} (${state.s3ConnectionId ?? "?"})`);
  }
}
