import { GeneratedRawContentItem } from "../../../../llm/llmServices/commonStructures/generatedRawContent";
import { GenerationTokens } from "../../../../llm/llmServices/commonStructures/generationTokens";
import { ModelParams } from "../../../../llm/llmServices/modelParams";

import { RankerType } from "../../../../core/contextTheoremRanker/contextTheoremsRanker";

import { TargetType } from "../../structures/benchmarkingCore/completionGenerationTask";
import {
    CompletionGenerationTime,
    FailureMetadata,
} from "../../structures/benchmarkingResults/benchmarkedItem";
import { SerializedCodeElementRange } from "../../structures/common/codeElementPositions";
import { LLMServiceIdentifier } from "../../structures/common/llmServiceIdentifier";
import { LengthMetrics } from "../../structures/common/measureStructures";
import { LightweightWorkspaceRoot } from "../../structures/inputParameters/lightweight/lightweightWorkspaceRoot";
import { SerializedTheoremsByNames } from "../../structures/parsedCoqFile/parsedCoqFileData";
import { SerializedGoal } from "../../utils/coqUtils/goalParser";

export namespace BasicJsonSerializationStructures {
    export interface SerializedBenchmarkedItem {
        item: SerializedBenchmarkingItem;
        resultByRounds: SerializedBenchmarkingResult[];
    }

    export interface SerializedBenchmarkingItem {
        task: SerializedCompletionGenerationTask;
        params: SerializedBenchmarkingModelParams<ModelParams>;
    }

    export interface SerializedCompletionGenerationTask {
        goalToProve: SerializedGoal;
        positionRange: SerializedCodeElementRange;
        targetType: TargetType;
        parsedSourceFile: SerializedSourceFile;
        sourceTheoremName: string;
        workspaceRoot: LightweightWorkspaceRoot;
    }

    export interface SerializedSourceFile {
        relativePath: string;
        serializedTheoremsByNames: SerializedTheoremsByNames;
        documentVersion: number;
    }

    export interface SerializedBenchmarkingModelParams<
        ResolvedModelParams extends ModelParams,
    > {
        theoremRanker: RankerType;
        modelParams: ResolvedModelParams;
        llmServiceIdentifier: LLMServiceIdentifier;
    }

    export type SerializedBenchmarkingResult =
        | SerializedFailedBenchmarking
        | SerializedSuccessfulBenchmarking;

    export interface SerializedBaseBenchmarkingResult {
        contextTheoremsNames: string[];
        tokensSpentInTotal: GenerationTokens;
        roundElapsedTime: CompletionGenerationTime;
        roundNumber: number;
        parentProofToFixId: number | undefined;
    }

    export interface ExtraRootBenchmarkingResultData {
        totalElapsedTime: CompletionGenerationTime;
        hasSuccessfullyFinished: boolean;
        isSuccessfulCompletion: boolean;
    }

    export interface SerializedFailedBenchmarking
        extends SerializedBaseBenchmarkingResult {
        generatedProofs: SerializedNonValidatedProof[];
        failureMetadata: FailureMetadata;
    }

    export interface SerializedSuccessfulBenchmarking
        extends SerializedBaseBenchmarkingResult {
        generatedProofs: SerializedValidatedProof[];
    }

    export interface SerializedBaseBenchmarkedProof {
        generatedProof: SerializedGeneratedProof;
        asString: string;
        length: LengthMetrics;
        generatedProofId: number;
    }

    export interface SerializedNonValidatedProof
        extends SerializedBaseBenchmarkedProof {}

    export interface SerializedValidatedProof
        extends SerializedBaseBenchmarkedProof {
        isValid: boolean;
        diagnostic: string | undefined;
    }

    export interface SerializedGeneratedProof {
        rawProof: GeneratedRawContentItem;
        proofGenerationContext: SerializedProofGenerationContext;
    }

    export interface SerializedProofGenerationContext {
        completionTarget: string;
        inputContextTheoremsNames: string[];
    }
}
