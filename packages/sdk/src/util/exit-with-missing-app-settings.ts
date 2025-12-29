import { getPackageManagerCommand } from "./get-package-manager-command.js";
import { hardExit } from "./hard-exit.js";
export function exitWithMissingAppSettings() {
    hardExit(`Could not find app.settings.ts. Run \`${getPackageManagerCommand("dev")}\` to generate it`);
}
