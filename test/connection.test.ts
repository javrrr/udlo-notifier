import { describe, expect, it, vi } from "vitest";
import { findS3Connection, requireS3Connection } from "../src/data-cloud/connection.js";

describe("data-cloud/connection", () => {
  it("requireS3Connection throws with setup guidance when none match", async () => {
    const client = {
      connections: {
        list: vi.fn().mockResolvedValue({ connections: [] }),
      },
    };
    await expect(requireS3Connection(client as never)).rejects.toThrow(/No S3 connection found/);
    await expect(requireS3Connection(client as never)).rejects.toThrow(/Data Cloud > Connections/);
  });

  it("findS3Connection returns first AwsS3 connection when no bucket filter", async () => {
    const conn = { id: "conn-1", name: "MyS3", label: "My S3", connectorType: "AwsS3" };
    const client = {
      connections: {
        list: vi.fn().mockImplementation(({ connectorType }: { connectorType: string }) => {
          if (connectorType === "AwsS3") {
            return Promise.resolve({ connections: [conn] });
          }
          return Promise.reject(new Error("unsupported"));
        }),
      },
    };
    const found = await findS3Connection(client as never);
    expect(found).toEqual({ id: "conn-1", name: "MyS3", label: "My S3" });
  });

  it("findS3Connection filters by bucket name in serialized connection", async () => {
    const match = { id: "a", name: "x", label: "x", params: [{ paramName: "bucket", value: "my-data-bucket" }] };
    const other = { id: "b", name: "y", label: "y", params: [{ paramName: "bucket", value: "other" }] };
    const client = {
      connections: {
        list: vi.fn().mockResolvedValue({ connections: [other, match] }),
      },
    };
    const found = await findS3Connection(client as never, "my-data-bucket");
    expect(found?.id).toBe("a");
  });
});
