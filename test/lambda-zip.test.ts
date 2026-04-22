import { describe, expect, it } from "vitest";
import { buildLambdaZip } from "../src/aws/lambda.js";

describe("buildLambdaZip", () => {
  it("produces a valid ZIP containing handler.mjs", () => {
    const zip = buildLambdaZip();
    expect(zip.slice(0, 4).toString("hex")).toBe("504b0304"); // local file header
    expect(zip.includes(Buffer.from("handler.mjs"))).toBe(true);
    expect(zip.includes(Buffer.from("export const handler"))).toBe(true);
    // End-of-central-directory marker.
    expect(zip.slice(-22, -18).toString("hex")).toBe("504b0506");
  });
});
