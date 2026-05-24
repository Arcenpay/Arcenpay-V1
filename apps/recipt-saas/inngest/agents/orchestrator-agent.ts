import { createAgent, openai } from "@inngest/agent-kit";
import { parsePdfTool } from "./receipt-scanning-agent";
import { saveToDatabaseTool } from "./database-agent";

export const orchestratorAgent = createAgent({
  name: "Receipt Orchestrator Agent",
  description:
    "A single agent that can parse PDFs and then save structured receipt data to the database.",
  system:
    "You are a helpful assistant orchestrating receipt parsing and persistence. First, extract data from the provided PDF. Then, persist the extracted data.",
  model: openai({
    model: "gpt-4o-mini",
    defaultParameters: {
      max_completion_tokens: 2000,
    },
  }),
  tools: [parsePdfTool, saveToDatabaseTool],
});
