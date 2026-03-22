import { Command } from "commander";
import { runMigrations, getAllConfig, setConfigSection, NexusConfigSchema } from "@nexus/core";

const VALID_SECTIONS = ["gateway", "agent", "security"] as const;
type ValidSection = (typeof VALID_SECTIONS)[number];

export const configCommand = new Command("config")
  .description("View and update Nexus configuration");

configCommand
  .command("get [section]")
  .description("Print configuration as JSON")
  .action((section?: string) => {
    runMigrations();
    const config = getAllConfig();

    if (section) {
      if (!VALID_SECTIONS.includes(section as ValidSection)) {
        console.error(
          `Unknown config section: "${section}". Valid sections: ${VALID_SECTIONS.join(", ")}`,
        );
        process.exit(1);
      }
      const value = config[section as keyof typeof config];
      console.log(JSON.stringify(value, null, 2));
    } else {
      console.log(JSON.stringify(config, null, 2));
    }
  });

configCommand
  .command("set <section> <json>")
  .description("Set a configuration section (pass JSON string)")
  .action((section: string, json: string) => {
    runMigrations();

    if (!VALID_SECTIONS.includes(section as ValidSection)) {
      console.error(
        `Unknown config section: "${section}". Valid sections: ${VALID_SECTIONS.join(", ")}`,
      );
      process.exit(1);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      console.error("Invalid JSON:", json);
      process.exit(1);
    }

    // Validate against the Zod schema for this section before persisting.
    const sectionSchema = NexusConfigSchema.shape[section as ValidSection];
    const validated = sectionSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(`Invalid config for section "${section}":\n${validated.error.message}`);
      process.exit(1);
    }

    setConfigSection(section, validated.data);
    console.log(`Config section "${section}" updated.`);
  });
