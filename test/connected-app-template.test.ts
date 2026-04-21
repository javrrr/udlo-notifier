import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("UDLO_Notifier connected app template", () => {
  it("includes certificate placeholder and expected OAuth scopes", () => {
    const xmlPath = join(
      process.cwd(),
      "force-app",
      "main",
      "default",
      "connectedApps",
      "UDLO_Notifier.connectedApp-meta.xml",
    );
    const xml = readFileSync(xmlPath, "utf-8");
    expect(xml).toContain("__CERTIFICATE_PEM__");
    expect(xml).toContain("<scopes>Api</scopes>");
    expect(xml).toContain("<scopes>RefreshToken</scopes>");
    expect(xml).toContain("<scopes>CDPIngest</scopes>");
    expect(xml).toContain("<scopes>CDPQuery</scopes>");
    expect(xml).toContain("<scopes>CDPProfile</scopes>");
    expect(xml).toContain("http://localhost:1717/OauthRedirect");
    expect(xml).toContain("<isTokenExchangeFlowEnabled>true</isTokenExchangeFlowEnabled>");
    expect(xml).toContain("<oauthPolicy>");
  });
});
