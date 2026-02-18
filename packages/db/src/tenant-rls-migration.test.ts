import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tenant RLS migration guardrails", () => {
  it("keeps tenant RLS enabled and forced for all operational tables", () => {
    const migrationSql = readFileSync(new URL("../drizzle/0002_easy_excalibur.sql", import.meta.url), "utf8");

    expect(migrationSql).toContain("ALTER TABLE \"shops\" ENABLE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("ALTER TABLE \"shops\" FORCE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("CREATE POLICY \"shops_tenant_rls\" ON \"shops\"");

    expect(migrationSql).toContain("ALTER TABLE \"product_cards\" ENABLE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("ALTER TABLE \"product_cards\" FORCE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("CREATE POLICY \"product_cards_tenant_rls\" ON \"product_cards\"");

    expect(migrationSql).toContain("ALTER TABLE \"sync_state\" ENABLE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("ALTER TABLE \"sync_state\" FORCE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("CREATE POLICY \"sync_state_tenant_rls\" ON \"sync_state\"");

    expect(migrationSql).toContain("ALTER TABLE \"job_runs\" ENABLE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("ALTER TABLE \"job_runs\" FORCE ROW LEVEL SECURITY;");
    expect(migrationSql).toContain("CREATE POLICY \"job_runs_tenant_rls\" ON \"job_runs\"");
  });

  it("keeps all tenant RLS policies bound to app.tenant_id", () => {
    const migrationSql = readFileSync(new URL("../drizzle/0002_easy_excalibur.sql", import.meta.url), "utf8");

    expect(migrationSql).toContain("current_setting('app.tenant_id', true)::uuid");
    expect(countOccurrences(migrationSql, "current_setting('app.tenant_id', true)::uuid")).toBeGreaterThanOrEqual(8);
  });
});

function countOccurrences(value: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  return value.split(needle).length - 1;
}
