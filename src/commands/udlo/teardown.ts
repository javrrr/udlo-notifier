import { Command, Flags } from "@oclif/core";
import { confirm } from "../../prompt.js";

export default class Teardown extends Command {
  static override description = "Tear down AWS resources created by sf udlo setup (Data Cloud UDLO optional)";

  static override flags = {
    "target-org": Flags.string({ char: "o", description: "Salesforce org alias or username" }),
    "aws-region": Flags.string({ description: "AWS region", default: "us-east-1" }),
    "auto-approve": Flags.boolean({ description: "Skip confirmation prompts" }),
    "keep-udlo": Flags.boolean({
      description: "Do not delete the Data Cloud UDLO (keeps lake object in the org)",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Teardown);
    const cwd = process.cwd();

    const { readState, clearState } = await import("../../state.js");
    const state = readState(cwd);
    const hasAws =
      Boolean(state.lambdaFunctionArn) ||
      Boolean(state.lambdaFunctionName) ||
      Boolean(state.lambdaRoleName) ||
      Boolean(state.consumerKeySecretName) ||
      Boolean(state.s3Bucket);
    if (!hasAws && !state.udloName) {
      this.error("No .udlo-state.json or nothing to tear down (need Lambda/S3/role/secrets or UDLO in state).");
    }

    if (!flags["auto-approve"]) {
      const ok = await confirm("Remove S3 notifications, Lambda, secrets, and IAM role from this machine's state?");
      if (!ok) {
        this.log("Aborted.");
        return;
      }
    }

    const { createAwsClients } = await import("../../aws/clients.js");
    const aws = createAwsClients(flags["aws-region"]);

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

    if (state.udloName && !flags["keep-udlo"]) {
      const shouldDelete =
        flags["auto-approve"] ||
        (await confirm(`Delete Data Cloud UDLO "${state.udloName}"? (Irreversible in org)`));
      if (shouldDelete) {
        this.log("\n── Data Cloud UDLO ──");
        try {
          const { resolveConnection } = await import("../../auth/sf-auth.js");
          const { createData360Client } = await import("../../data-cloud/client.js");
          const { destroyUdlo } = await import("../../data-cloud/udlo.js");
          const conn = await resolveConnection(flags["target-org"]);
          const dc = createData360Client(conn);
          await destroyUdlo(dc, state.udloName);
          this.log(`  Deleted ${state.udloName}`);
        } catch (e) {
          this.warn(`  UDLO: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        this.log("\n── Data Cloud UDLO ── skipped");
      }
    }

    this.log("\n── Connected App ──");
    this.log("  Left in place (UDLO_Notifier). Remove from Setup > App Manager if you no longer need it.");

    clearState(cwd);
    this.log("\n── Cleared .udlo-state.json ──");
  }
}
