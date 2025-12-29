import { getPackageManagerCommand } from "./get-package-manager-command.js";
import { hardExit } from "./hard-exit.js";
export function exitWithMissingEntryPoint() {
    hardExit(`Could not find app.ts. Run \`${getPackageManagerCommand("dev")}\` to generate it`);
}
