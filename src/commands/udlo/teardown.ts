import { Command, Flags } from "@oclif/core";
import { confirm } from "../../prompt.js";

export default class Teardown extends Command {
  static override description =
    "Tear down AWS resources created by udlo setup (does not remove the UDLO in Data Cloud)";

  static override flags = {
    "target-org": Flags.string({ char: "o", description: "Salesforce org alias or username" }),
    "aws-region": Flags.string({ description: "AWS region", default: "us-east-1" }),
    "aws-profile": Flags.string({
      description: "AWS named profile; optional. Overrides saved awsProfile in `.udlo-notifier/state.json`.",
    }),
    "auto-approve": Flags.boolean({ description: "Skip confirmation prompts" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Teardown);
    const cwd = process.cwd();

    const { readState, removeUdloWorkspace } = await import("../../state.js");
    const state = readState(cwd);
    const hasAws =
      Boolean(state.lambdaFunctionArn) ||
      Boolean(state.lambdaFunctionName) ||
      Boolean(state.lambdaRoleName) ||
      Boolean(state.consumerKeySecretName) ||
      Boolean(state.s3Bucket);
    if (!hasAws && !state.udloName) {
      this.error(
        "No `.udlo-notifier` state or nothing to tear down (need Lambda/S3/role/secrets or UDLO in state).",
      );
    }

    if (!flags["auto-approve"]) {
      const ok = await confirm("Remove S3 notifications, Lambda, secrets, and IAM role from this machine's state?");
      if (!ok) {
        this.log("Aborted.");
        return;
      }
    }

    const { createAwsClients } = await import("../../aws/clients.js");
    const awsProfile = flags["aws-profile"]?.trim() || state.awsProfile;
    const aws = createAwsClients(flags["aws-region"], { profile: awsProfile });

    if (state.s3Bucket && state.lambdaFunctionArn) {
      this.log("\n── S3 notifications ──");
      const { removeS3Events } = await import("../../aws/s3-events.js");
      try {
        await removeS3Events(aws.s3, state.s3Bucket, state.lambdaFunctionArn);
        this.log("  Removed this Lambda from bucket notification configuration.");
      } catch (e) {
        this.warn(`  S3 notifications: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (state.lambdaFunctionName) {
      this.log("\n── Lambda ──");
      const { destroyLambda } = await import("../../aws/lambda.js");
      try {
        await destroyLambda(aws.lambda, state.lambdaFunctionName);
        this.log(`  Deleted ${state.lambdaFunctionName}`);
      } catch (e) {
        this.warn(`  Lambda: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const secretNames = [state.consumerKeySecretName, state.rsaKeySecretName].filter(
      (n): n is string => typeof n === "string" && n.length > 0,
    );
    if (secretNames.length > 0) {
      this.log("\n── Secrets ──");
      const { destroySecrets } = await import("../../aws/secrets.js");
      try {
        await destroySecrets(aws.secretsManager, secretNames);
        this.log(`  Deleted ${secretNames.length} secret(s).`);
      } catch (e) {
        this.warn(`  Secrets: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (state.lambdaRoleName) {
      this.log("\n── IAM role ──");
      const { destroyLambdaRole } = await import("../../aws/iam.js");
      try {
        await destroyLambdaRole(aws.iam, state.lambdaRoleName);
        this.log(`  Deleted ${state.lambdaRoleName}`);
      } catch (e) {
        this.warn(`  IAM: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (state.udloName) {
      this.log("\n── Data Cloud UDLO ──");
      this.log(`  Left in place (${state.udloName}). Remove it in Data Cloud if you no longer need it.`);
    }

    this.log("\n── Connected App ──");
    this.log("  Left in place (UDLO_Notifier). Remove from Setup > App Manager if you no longer need it.");

    removeUdloWorkspace(cwd);
    this.log("\n── Removed `.udlo-notifier/` workspace (state + local keys) ──");
  }
}
