import { OpenAiModelParams, ModelParams } from "../modelParams";
import { ProofGenerationContext } from "../llmService";
import { GeneratedProof, LLMService, ProofVersion } from "../llmService";
import { EventLogger, Severity } from "../../../logging/eventLogger";
import { Proof } from "../llmService";
import { ChatHistory } from "../chat";
import OpenAI from "openai";

export class OpenAiService extends LLMService {
    constructor(eventLogger?: EventLogger) {
        super(eventLogger);
    }

    constructGeneratedProof(
        proof: string,
        proofGenerationContext: ProofGenerationContext,
        modelParams: ModelParams,
        previousProofVersions?: ProofVersion[]
    ): GeneratedProof {
        return new OpenAiGeneratedProof(
            proof,
            proofGenerationContext,
            modelParams as OpenAiModelParams,
            this,
            previousProofVersions
        );
    }

    async generateFromChat(
        chat: ChatHistory,
        params: ModelParams,
        choices: number
    ): Promise<string[]> {
        // TODO: support retries
        const openAiParams = params as OpenAiModelParams;
        const openai = new OpenAI({ apiKey: openAiParams.apiKey });

        this.eventLogger?.log(
            "openai-fetch-started",
            "Generate with OpenAI",
            { history: chat },
            Severity.DEBUG
        );
        const completion = await openai.chat.completions.create({
            messages: chat,
            model: openAiParams.modelName,
            n: choices,
            temperature: openAiParams.temperature,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            max_tokens: openAiParams.newMessageMaxTokens,
        });

        return completion.choices.map((choice: any) => choice.message.content);
    }
}

export class OpenAiGeneratedProof extends GeneratedProof {
    constructor(
        proof: Proof,
        proofGenerationContext: ProofGenerationContext,
        modelParams: OpenAiModelParams,
        llmService: OpenAiService,
        previousProofVersions?: ProofVersion[]
    ) {
        super(
            proof,
            proofGenerationContext,
            modelParams,
            llmService,
            previousProofVersions
        );
    }
}
