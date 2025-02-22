import { GenerationTokens } from "../../../../llm/llmServices/commonStructures/generationTokens";
import { GeneratedProof } from "../../../../llm/llmServices/generatedProof";

import { ProofCheckResult } from "../../../../core/coqProofChecker";

import { invariantFailed } from "../../../../utils/throwErrors";
import { LengthMetrics } from "../common/measureStructures";

import { BenchmarkingResult } from "./benchmarkedItem";

export type BenchmarkedProof = NonValidatedProof | ValidatedProof;

abstract class AbstractBenchmarkedProof {
    constructor(
        readonly proofObject: GeneratedProof,
        /**
         * The proof content as a string, formatted for insertion into source code.
         *
         * _Note:_ this may differ slightly from `proofObject.proof`.
         */
        readonly asString: string,
        /**
         * Proof identifier unique among all proofs generated by single benchmarking task.
         * Provides better navigation in the serialized results.
         */
        readonly generatedProofId: number
    ) {}

    /**
     * Tokens spent to generate this specific proof.
     *
     * **Warning:** most likely, these metrics might be just an approximate estimation of the real ones.
     * To get probably more accurate (but aggregated) data,
     * use `BenchmarkedCompletionGeneration.tokensSpentInTotal` instead (check its docs for more details).
     */
    readonly tokensSpent: GenerationTokens =
        this.proofObject.rawProof.tokensSpent;

    readonly length = measureLength(this.asString);

    isValidated(): this is ValidatedProof {
        const maybeValidatedProof = this as unknown as ValidatedProof;
        // Note: yes, here the method presence is checked, since `isValid` property is private
        return maybeValidatedProof.isValidProof !== undefined;
    }
}

export function measureLength(proof: string): LengthMetrics {
    return {
        inSymbols: proof.length,
        inSteps: proof.split(".").length, // TODO: check and perform more accurately
        inTokens: undefined, // TODO
    };
}

export class NonValidatedProof extends AbstractBenchmarkedProof {
    constructor(
        proofObject: GeneratedProof,
        asString: string,
        generatedProofId: number
    ) {
        super(proofObject, asString, generatedProofId);
    }

    validate(checkedProof: ProofCheckResult): ValidatedProof {
        if (checkedProof.isValid) {
            return new ValidProof(
                this.proofObject,
                this.asString,
                this.generatedProofId
            );
        }
        return new NonValidProof(
            this.proofObject,
            this.asString,
            this.generatedProofId,
            checkedProof.diagnostic ??
                invariantFailed(
                    "`CoqProofChecker`",
                    "non-valid proof cannot have `undefined` diagnostic"
                )
        );
    }
}

export type ValidatedProof = NonValidProof | ValidProof;

abstract class AbstractValidatedProof extends AbstractBenchmarkedProof {
    constructor(
        proofObject: GeneratedProof,
        asString: string,
        generatedProofId: number,
        private readonly isValid: boolean
    ) {
        super(proofObject, asString, generatedProofId);
    }

    isValidProof(): this is ValidProof {
        return this.isValid;
    }

    isNonValidProof(): this is NonValidProof {
        return !this.isValid;
    }

    private nextProofFixRoundResult: BenchmarkingResult | undefined = undefined;

    get nextRoundResult(): BenchmarkingResult | undefined {
        return this.nextProofFixRoundResult;
    }

    linkNextRoundResult(proofFixRoundResult: BenchmarkingResult) {
        this.nextProofFixRoundResult = proofFixRoundResult;
    }
}

export class NonValidProof extends AbstractValidatedProof {
    constructor(
        proofObject: GeneratedProof,
        asString: string,
        generatedProofId: number,
        readonly diagnostic: string
    ) {
        super(proofObject, asString, generatedProofId, false);
    }
}

export class ValidProof extends AbstractValidatedProof {
    constructor(
        proofObject: GeneratedProof,
        asString: string,
        generatedProofId: number
    ) {
        super(proofObject, asString, generatedProofId, true);
    }
}
