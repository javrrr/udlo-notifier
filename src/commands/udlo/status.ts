import { Command } from "@oclif/core";

export default class Status extends Command {
  static override description = "Check UDLO pipeline health";

  async run(): Promise<void> {
    this.log("sf udlo status will report pipeline health in a later phase.");
  }
}
