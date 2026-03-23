import { createLogger } from "../logger.js";
import { recordAudit } from "../audit.js";

const log = createLogger("core:security:prompt-guard");

export interface Detection {
  pattern: string;
  match: string;
  index: number;
}

export interface ScanResult {
  safe: boolean;
  detections: Detection[];
}

const INJECTION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "ignore_previous", regex: /ignore\s+(previous|prior|all\s+previous)\s+instructions?/i },
  { name: "system_prompt", regex: /system\s*prompt/i },
  { name: "you_are_now", regex: /you\s+are\s+now\s+/i },
  { name: "act_as", regex: /\bact\s+as\s+(a\s+|an\s+)?[a-z]/i },
  { name: "disregard", regex: /disregard\s+(your|all|previous|prior)/i },
  { name: "forget_instructions", regex: /forget\s+(your|all|previous|prior)?\s*instructions?/i },
  { name: "new_instructions", regex: /new\s+instructions?\s*:/i },
  { name: "override", regex: /\boverride\s+(?:(?:your|all|the|previous|prior)\s+)+(?:instructions?|rules?|constraints?|guidelines?)/i },
  { name: "pretend", regex: /\bpretend\s+(you\s+are|to\s+be)\b/i },
  { name: "jailbreak_do", regex: /\bdo\s+anything\s+now\b/i },
  { name: "xml_injection", regex: /<\s*(?:system|instructions?|prompt|context)\s*>/i },
  { name: "bracket_injection", regex: /\[\s*(?:SYSTEM|INST|INSTRUCTIONS?|OVERRIDE|JAILBREAK)\s*\]/i },
  { name: "role_switch", regex: /\byour\s+(real|true|actual)\s+(self|persona|identity|role)\b/i },
  { name: "reveal_prompt", regex: /\b(reveal|show|print|output|repeat|display)\s+(your\s+)?(system\s+)?prompt\b/i },
  { name: "bypass_safety", regex: /bypass\s+(safety|security|content|filter|restriction|guideline)/i },
  { name: "developer_mode", regex: /\bdeveloper\s*mode\b/i },
];

export function scanForInjection(text: string): ScanResult {
  const detections: Detection[] = [];

  for (const { name, regex } of INJECTION_PATTERNS) {
    const match = regex.exec(text);
    if (match !== null) {
      detections.push({
        pattern: name,
        match: match[0],
        index: match.index,
      });
    }
  }

  return { safe: detections.length === 0, detections };
}

export function enforcePromptGuard(
  text: string,
  policy: "enforce" | "warn" | "off",
): void {
  if (policy === "off") return;

  const result = scanForInjection(text);
  if (result.safe) return;

  const detectionSummary = result.detections.map((d) => d.pattern).join(", ");

  recordAudit("security:prompt_injection_detected", undefined, {
    policy,
    patterns: detectionSummary,
    detectionCount: result.detections.length,
  });

  if (policy === "enforce") {
    log.warn({ detections: detectionSummary }, "Prompt injection detected — blocking (enforce)");
    throw new Error(
      `Prompt injection detected: ${detectionSummary}`,
    );
  }

  if (policy === "warn") {
    log.warn({ detections: detectionSummary }, "Prompt injection detected — proceeding (warn)");
  }
}
