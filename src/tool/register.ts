import { cmdTool } from "./cmd.ts";
import { editTool } from "./edit.ts";
import { readFileTool } from "./read-file.ts";
import { recallTool } from "./recall.ts";
import { rememberTool } from "./remember.ts";
import { Registry } from "./registry.ts";
import { searchTool } from "./search.ts";
import { writeFileTool } from "./write-file.ts";

/** Process-wide registry. Tools that need runtime state register later, from index. */
export const defaultRegistry = new Registry();

defaultRegistry.register(cmdTool);
defaultRegistry.register(editTool);
defaultRegistry.register(readFileTool);
defaultRegistry.register(writeFileTool);
defaultRegistry.register(rememberTool);
defaultRegistry.register(recallTool);
defaultRegistry.register(searchTool);
