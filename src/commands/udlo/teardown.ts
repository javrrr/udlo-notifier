import { Command, Flags } from "@oclif/core";
import { createAwsClients } from "../../aws/clients.js";
import { destroyLambdaRole } from "../../aws/iam.js";
import { destroyLambda } from "../../aws/lambda.js";
import { removeS3Events } from "../../aws/s3-events.js";
import { destroySecrets } from "../../aws/secrets.js";
import { readState, removeWorkspace } from "../../state.js";

export default class Teardown extends Command {
  static override description = "Tear down AWS resources (Lambda, IAM role, secrets, S3 notifications)";

  static override flags = {
    "aws-region": Flags.string({ description: "AWS region (defaults to saved value from setup)" }),
    "aws-profile": Flags.string({ description: "AWS named profile" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Teardown);
    const cwd = process.cwd();
    const state = readState(cwd);

    if (!state.lambdaFunctionName && !state.s3Bucket && !state.lambdaRoleName) {
      this.error("No `.udlo-notifier/state.json` found — nothing to tear down.");
    }

    const region = flags["aws-region"]?.trim() || state.awsRegion;
    if (!region) this.error("No AWS region. Pass --aws-region or run setup first so it is saved to state.");
    const aws = createAwsClients(region, flags["aws-profile"]?.trim() || state.awsProfile);
    this.log(`Region ${region}${state.awsProfile ? ` profile ${state.awsProfile}` : ""}`);

    const step = async (label: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
        this.log(`✓ ${label}`);
      } catch (e) {
        this.warn(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    if (state.s3Bucket && state.lambdaFunctionArn) {
      await step("Removed S3 notification", () => removeS3Events(aws.s3, state.s3Bucket!, state.lambdaFunctionArn!));
    }
    if (state.lambdaFunctionName) {
      await step(`Deleted Lambda ${state.lambdaFunctionName}`, () => destroyLambda(aws.lambda, state.lambdaFunctionName!));
    }
    const secrets = [state.consumerKeySecretName, state.rsaKeySecretName].filter((s): s is string => !!s);
    if (secrets.length > 0) {
      await step(`Deleted ${secrets.length} secret(s)`, () => destroySecrets(aws.secrets, secrets));
    }
    if (state.lambdaRoleName) {
      await step(`Deleted IAM role ${state.lambdaRoleName}`, () => destroyLambdaRole(aws.iam, state.lambdaRoleName!));
    }

    removeWorkspace(cwd);
    this.log("✓ Removed `.udlo-notifier/` workspace");
    this.log("\nConnected App and UDLO left in place — remove from Salesforce UI if no longer needed.");
  }
}
