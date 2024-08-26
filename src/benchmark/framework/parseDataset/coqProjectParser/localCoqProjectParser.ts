import { BenchmarkingLogger } from "../../logging/benchmarkingLogger";
import { WorkspaceInputTargets } from "../../structures/inputTargets";
import { WorkspaceRoot } from "../../structures/workspaceRoot";

import {
    AbstractCoqProjectParser,
    CoqProjectParsingFailedError,
} from "./abstractCoqProjectParser";
import { CoqProjectParserUtils } from "./implementation/coqProjectParserUtils";
import { ParseCoqProjectInternalSignature } from "./implementation/internalSignature";
import { ParseCoqProjectImpl } from "./implementation/parseCoqProject";
import { ParsedWorkspaceHolder } from "./implementation/parsedWorkspaceHolder";

/**
 * **Warning:** this part of implementation requires `vscode` module imported to work.
 * Thus, do not use it in the code that is called outside the `test-electron` environment.
 */
export class LocalCoqProjectParser extends AbstractCoqProjectParser {
    async parseCoqProject(
        targets: WorkspaceInputTargets,
        workspaceRoot: WorkspaceRoot,
        logger: BenchmarkingLogger
    ): Promise<ParsedWorkspaceHolder> {
        const workspaceTargets =
            CoqProjectParserUtils.packWorkspaceTargets(targets);
        const args = CoqProjectParserUtils.buildArgs(
            workspaceTargets,
            workspaceRoot
        );
        const parsedWorkspace = await this.parseCoqProjectAndWrapError(
            args,
            logger
        );
        return new ParsedWorkspaceHolder(parsedWorkspace);
    }

    private async parseCoqProjectAndWrapError(
        args: ParseCoqProjectInternalSignature.ArgsModels.Args,
        logger: BenchmarkingLogger
    ) {
        try {
            return await ParseCoqProjectImpl.parseCoqProject(args, logger);
        } catch (error) {
            if (error instanceof Error) {
                throw new CoqProjectParsingFailedError(
                    error.name,
                    error.message
                );
            } else {
                throw error;
            }
        }
    }
}
