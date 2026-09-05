import fs from "node:fs";
import { buildSystemPrompt, buildUserText } from "../../../src/lib/skill";
fs.writeFileSync("paper/cheap-world-model/experiments/system-prompt.txt", buildSystemPrompt() + "\n\n[user message]\n" + buildUserText() + "\n");
