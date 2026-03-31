/**
 * nexus security — security audit and hardening commands.
 *
 * Subcommands:
 *   audit   — Run the security audit report and display results.
 */
import { Command } from "commander";
import { runMigrations, runSecurityAudit } from "@nexus/core";
import type { AuditCheck, AuditReport } from "@nexus/core";

const PASS = "\u2713";
const WARN = "\u26a0";
const FAIL = "\u2717";

function statusIcon(status: AuditCheck["status"]): string {
  if (status === "pass") return PASS;
  if (status === "warn") return WARN;
  return FAIL;
}

function formatReport(report: AuditReport): void {
  console.log("Nexus Security Audit");
  console.log("====================");
  for (const check of report.checks) {
    const icon = statusIcon(check.status);
    const label = check.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    console.log(`  ${icon} [${check.status.toUpperCase()}] ${label}`);
    console.log(`      ${check.detail}`);
  }
  console.log("");
  console.log(`Score  : ${report.score}/100`);
  console.log(`Summary: ${report.summary}`);
}

const auditCommand = new Command("audit")
  .description("Run security checks and display a scored audit report")
  .option("--json", "Output results as JSON")
  .action(() => {
    runMigrations();

    let report: AuditReport;
    try {
      report = runSecurityAudit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Security audit failed: ${msg}`);
      process.exit(1);
    }

    const jsonFlag = auditCommand.opts()["json"] as boolean | undefined;
    if (jsonFlag) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      formatReport(report);
    }

    const hasCritical = report.checks.some((c) => c.status === "fail");
    if (hasCritical) {
      process.exit(1);
    }
  });

export const securityCommand = new Command("security")
  .description("Security hardening and audit commands")
  .addCommand(auditCommand);
