import { Command } from "@oclif/core";

export default class Teardown extends Command {
  static override description = "Tear down the UDLO pipeline resources created by setup";

  async run(): Promise<void> {
    this.log("sf udlo teardown will reverse setup steps in a later phase.");
  }
}
