import { ValidateFunction } from "ajv";

import {
    AjvMode,
    buildAjv,
    failedAjvValidatorErrorsAsString,
} from "../../../../utils/ajvErrorsHandling";
import { buildErrorCompleteLog } from "../../../../utils/errorsUtils";
import { BenchmarkingLogger } from "../../logging/benchmarkingLogger";
import { TargetType } from "../../structures/benchmarkingCore/completionGenerationTask";
import { deserializeCodeElementRange } from "../../structures/common/codeElementPositions";
import { deserializeTheoremData } from "../../structures/parsedCoqFile/theoremData";
import { packIntoMap } from "../../utils/collectionUtils/mapUtils";
import { deserializeGoal } from "../../utils/coqUtils/goalParser";
import {
    exists,
    getDatasetDir,
    isFile,
    joinPaths,
    readFile,
    relativizeAbsolutePaths,
    resolveAsAbsolutePath,
} from "../../utils/fileUtils/fs";
import {
    CacheHolderData,
    WorkspaceCacheHolder,
} from "../cacheStructures/cacheHolders";
import { DatasetCacheModels } from "../cacheStructures/cacheModels";
import { joinJsonExtension } from "../utils/fileJsonExtension";

export function readRequestedFilesCache(
    requestedFilePaths: string[],
    workspacePath: string,
    datasetCacheDirectoryPath: string,
    parentLogger: BenchmarkingLogger
): WorkspaceCacheHolder {
    const datasetDir = getDatasetDir();
    const cacheDir = resolveAsAbsolutePath(datasetCacheDirectoryPath);
    const cachedFileValidator = buildAjv(AjvMode.COLLECT_ALL_ERRORS).compile(
        DatasetCacheModels.cachedCoqFileSchema
    );
    const logger = parentLogger.createChildLoggerWithIdentifier(
        `[Dataset Cache Reader, cache path = ${datasetCacheDirectoryPath}]`
    );
    const workspaceCache =
        BuildCacheHoldersFromModels.buildWorkspaceCacheHolder(
            packIntoMap(
                requestedFilePaths,
                (filePath) => filePath,
                (resolvedSourceFilePath) => {
                    const filePathRelativeToDataset = relativizeAbsolutePaths(
                        datasetDir,
                        resolvedSourceFilePath
                    );
                    const resolvedCachedFilePath = joinPaths(
                        cacheDir,
                        joinJsonExtension(filePathRelativeToDataset)
                    );
                    if (
                        !(
                            exists(resolvedCachedFilePath) &&
                            isFile(resolvedCachedFilePath)
                        )
                    ) {
                        return undefined;
                    }
                    return readCachedCoqFile(
                        resolvedCachedFilePath,
                        resolvedSourceFilePath,
                        cachedFileValidator,
                        logger
                    );
                }
            ),
            workspacePath
        );
    if (workspaceCache.noCacheFilesRead()) {
        logger.info(`No parsing cache was found for ${workspacePath} project.`);
    }
    return workspaceCache;
}

function readCachedCoqFile(
    cachedFilePath: string,
    sourceFilePath: string,
    cachedFileValidator: ValidateFunction<DatasetCacheModels.CachedCoqFile>,
    logger: BenchmarkingLogger
): DatasetCacheModels.CachedCoqFile | undefined {
    const cachedFileContent = readFile(cachedFilePath, (error) => {
        logger.error(
            `Failed to read a cache file "${cachedFilePath}" for a source file "${sourceFilePath}": ${error.message}`
        );
        return undefined;
    });
    if (cachedFileContent === undefined) {
        return undefined;
    }
    try {
        const cachedCoqFile = JSON.parse(
            cachedFileContent
        ) as DatasetCacheModels.CachedCoqFile;
        if (!cachedFileValidator(cachedCoqFile)) {
            logger.error(
                `Failed to parse a cache file "${cachedFilePath}", bad format: ${failedAjvValidatorErrorsAsString(cachedFileValidator)}`
            );
            return undefined;
        }
        logger.debug(
            `Successfully found & read a cache file "${cachedFilePath}" for a source file "${sourceFilePath}"`
        );
        return cachedCoqFile;
    } catch (e) {
        logger.error(
            `Failed to parse a cache file "${cachedFilePath}", bad format:\n${buildErrorCompleteLog(e)}`
        );
        return undefined;
    }
}

namespace BuildCacheHoldersFromModels {
    export function buildWorkspaceCacheHolder(
        filePathToReadCachedFile: Map<string, DatasetCacheModels.CachedCoqFile>,
        workspacePath: string
    ): WorkspaceCacheHolder {
        return new WorkspaceCacheHolder(
            workspacePath,
            new Map(
                Array.from(filePathToReadCachedFile.entries()).map(
                    ([filePath, readCachedFile]) => [
                        filePath,
                        buildCachedCoqFileData(readCachedFile, workspacePath),
                    ]
                )
            )
        );
    }

    export function buildCachedCoqFileData(
        readCachedFile: DatasetCacheModels.CachedCoqFile,
        workspacePath: string
    ): CacheHolderData.CachedCoqFileData {
        const theorems = new Map();
        for (const theoremName of Object.keys(readCachedFile.allFileTheorems)) {
            const readCachedTheorem =
                readCachedFile.allFileTheorems[theoremName];
            theorems.set(
                theoremName,
                buildCachedTheoremData(readCachedTheorem)
            );
        }
        return new CacheHolderData.CachedCoqFileData(
            theorems,
            readCachedFile.filePathRelativeToWorkspace,
            readCachedFile.documentVersion,
            workspacePath
        );
    }

    export function buildCachedTheoremData(
        readCachedTheorem: DatasetCacheModels.CachedTheorem
    ): CacheHolderData.CachedTheoremData {
        return new CacheHolderData.CachedTheoremData(
            deserializeTheoremData(readCachedTheorem.theorem),
            new Map<TargetType, CacheHolderData.CachedTargetData[]>([
                [
                    TargetType.PROVE_THEOREM,
                    [buildCachedTargetData(readCachedTheorem.proofTarget)],
                ],
                [
                    TargetType.ADMIT,
                    readCachedTheorem.admitTargets.map((admitTarget) =>
                        buildCachedTargetData(admitTarget)
                    ),
                ],
            ])
        );
    }

    export function buildCachedTargetData(
        readCachedTarget: DatasetCacheModels.CachedTarget
    ): CacheHolderData.CachedTargetData {
        return new CacheHolderData.CachedTargetData(
            readCachedTarget.goalToProve === undefined
                ? undefined
                : deserializeGoal(readCachedTarget.goalToProve),
            deserializeCodeElementRange(readCachedTarget.positionRange)
        );
    }
}
