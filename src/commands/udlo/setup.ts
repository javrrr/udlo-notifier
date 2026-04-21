import { Command } from "@oclif/core";

export default class Setup extends Command {
  static override description =
    "Set up an S3-to-Data-Cloud unstructured data pipeline (orchestration not wired yet — see PLAN.md Phase 5)";

  async run(): Promise<void> {
    this.log("sf udlo setup will run the full pipeline in a later phase.");
  }
}
