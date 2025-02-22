import {
    DatasetInputTargets,
    mergeInputTargets,
} from "../../structures/common/inputTargets";
import { LLMServiceIdentifier } from "../../structures/common/llmServiceIdentifier";
import { InputBenchmarkingModelParams } from "../../structures/inputParameters/inputBenchmarkingModelParams";
import { AbstractExperiment } from "../abstractExperiment";

export type LLMServiceStringIdentifier =
    | "predefined"
    | "openai"
    | "grazie"
    | "lmstudio"
    | "deepseek";

export type CorrespondingInputParams<T extends LLMServiceStringIdentifier> =
    T extends "predefined"
        ? InputBenchmarkingModelParams.PredefinedProofsParams
        : T extends "openai"
          ? InputBenchmarkingModelParams.OpenAiParams
          : T extends "grazie"
            ? InputBenchmarkingModelParams.GrazieParams
            : T extends "lmstudio"
              ? InputBenchmarkingModelParams.LMStudioParams
              : T extends "deepseek"
                ? InputBenchmarkingModelParams.DeepSeekParams
                : never;

export class BenchmarkingBundle {
    constructor() {}

    withLLMService<T extends LLMServiceStringIdentifier>(
        llmServiceStringIdentifier: T
    ): BenchmarkingBundleWithLLMService<CorrespondingInputParams<T>> {
        return new BenchmarkingBundleWithLLMService(
            this.toEnumIdentifier(llmServiceStringIdentifier)
        );
    }

    private toEnumIdentifier(
        llmServiceStringIdentifier: LLMServiceStringIdentifier
    ): LLMServiceIdentifier {
        switch (llmServiceStringIdentifier) {
            case "predefined":
                return LLMServiceIdentifier.PREDEFINED_PROOFS;
            case "openai":
                return LLMServiceIdentifier.OPENAI;
            case "grazie":
                return LLMServiceIdentifier.GRAZIE;
            case "lmstudio":
                return LLMServiceIdentifier.LMSTUDIO;
            case "deepseek":
                return LLMServiceIdentifier.DEEPSEEK;
        }
    }
}

export class BenchmarkingBundleWithLLMService<
    InputParams extends InputBenchmarkingModelParams.Params,
> {
    constructor(private readonly llmServiceIdentifier: LLMServiceIdentifier) {}

    withBenchmarkingModelsParamsCommons<
        InputParamsCommons extends Partial<InputParams>,
    >(commons: InputParamsCommons) {
        return new BenchmarkingBundleWithModelsParamsCommons<
            InputParams,
            InputParamsCommons
        >(this, commons);
    }

    withBenchmarkingModelsParams(
        ...inputParams: InputParams[]
    ): BenchmarkingBundleWithModelsParams<InputParams> {
        return new BenchmarkingBundleWithModelsParams(
            this.llmServiceIdentifier,
            inputParams
        );
    }
}

export class BenchmarkingBundleWithModelsParamsCommons<
    InputParams extends InputBenchmarkingModelParams.Params,
    InputParamsCommons extends Partial<InputParams>,
> {
    constructor(
        private readonly parentBundle: BenchmarkingBundleWithLLMService<InputParams>,
        private readonly modelsParamsCommons: InputParamsCommons
    ) {}

    withBenchmarkingModelsParams(
        ...inputBenchmarkingModelsParams: (Omit<
            InputParams,
            keyof Required<InputParamsCommons>
        > &
            Partial<Required<InputParamsCommons>>)[] // comment `& ...` to forbid overriding common properties
    ): BenchmarkingBundleWithModelsParams<InputParams> {
        return this.parentBundle.withBenchmarkingModelsParams(
            ...inputBenchmarkingModelsParams.map((params) => {
                // Indeed, here undefined value can be passed for a required property (through `inputParam`).
                // However, it will be checked later at the resolution stage and the error will be thrown.
                return {
                    ...this.modelsParamsCommons,
                    ...params,
                } as unknown as InputParams;
            })
        );
    }
}

export class BenchmarkingBundleWithModelsParams<
    InputParams extends InputBenchmarkingModelParams.Params,
> {
    constructor(
        private readonly llmServiceIdentifier: LLMServiceIdentifier,
        private readonly inputBenchmarkingModelsParams: InputParams[]
    ) {}

    withTargets(
        ...targets: DatasetInputTargets[]
    ): BenchmarkingBundleWithTargets<InputParams> {
        return new BenchmarkingBundleWithTargets(
            this.llmServiceIdentifier,
            this.inputBenchmarkingModelsParams,
            targets
        );
    }
}

export class BenchmarkingBundleWithTargets<
    InputParams extends InputBenchmarkingModelParams.Params,
> {
    constructor(
        private readonly llmServiceIdentifier: LLMServiceIdentifier,
        private readonly inputBenchmarkingModelsParams: InputParams[],
        private readonly targets: DatasetInputTargets[]
    ) {}

    addTo(experiment: AbstractExperiment) {
        experiment.addBundle({
            llmServiceIdentifier: this.llmServiceIdentifier,
            inputBenchmarkingModelsParams: this.inputBenchmarkingModelsParams,
            requestedTargets: mergeInputTargets(this.targets).resolveRequests(),
        });
    }
}
