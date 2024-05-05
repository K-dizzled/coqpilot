import { ChatHistory, ChatRole } from "../../chat";
import { ModelParams } from "../../modelParams";

export type ResponseStatus = "SUCCESS" | "FAILURE";

export interface LoggedError {
    typeName: string;
    message: string;
}

export class ParsingError extends Error {
    constructor(message: string, rawParsingData: string) {
        const parsingDataInfo = `\n>> \`${rawParsingData}\``;
        super(`failed to parse log record: ${message}${parsingDataInfo}`);
    }
}

export class LoggerRecord {
    /**
     * Even though this value is in millis, effectively it represents seconds.
     * I.e. this value is always floored to the seconds (`value % 1000 === 0`).
     *
     * The reason is that, unfortunately, the current serialization-deserialization
     * cycle neglects milliseconds.
     */
    readonly timestampMillis: number;

    protected static floorMillisToSeconds(millis: number): number {
        return millis - (millis % 1000);
    }

    constructor(
        timestampMillis: number,
        readonly modelId: string,
        readonly responseStatus: ResponseStatus,
        readonly choices: number,
        readonly estimatedTokens: number | undefined = undefined,
        readonly error: LoggedError | undefined = undefined
    ) {
        this.timestampMillis =
            LoggerRecord.floorMillisToSeconds(timestampMillis);
    }

    serializeToString(): string {
        const introInfo = this.buildStatusLine();
        const errorInfo = this.buildErrorInfo();
        const requestInfo = this.buildRequestInfo();
        return `${introInfo}${errorInfo}${requestInfo}`;
    }

    toString(): string {
        return this.serializeToString();
    }

    protected buildStatusLine(): string {
        const timestamp = new Date(this.timestampMillis).toLocaleString();
        return `[${timestamp}] \`${this.modelId}\` model: ${this.responseStatus}\n`;
    }

    protected buildErrorInfo(): string {
        if (this.error === undefined) {
            return "";
        }
        return `! error occurred: [${this.error.typeName}] "${LoggerRecord.escapeNewlines(this.error.message)}"\n`;
    }

    protected buildRequestInfo(): string {
        const choicesRequested = `- requested choices: ${this.choices}`;
        const requestTokens = `- request's tokens: ${this.estimatedTokens}`;
        return `${choicesRequested}\n${requestTokens}\n`;
    }

    protected static escapeNewlines(text: string): string {
        return text.replace("\n", "\\n");
    }

    protected static readonly introLinePattern =
        /^\[(.*)\] `(.*)` model: (.*)$/;
    protected static loggedErrorPattern = /^! error occurred: \[(.*)\] "(.*)"$/;
    protected static choicesPattern = /^- requested choices: (.*)$/;
    protected static requestTokensPattern = /^- request's tokens: (.*)$/;

    static deserealizeFromString(rawRecord: string): [LoggerRecord, string] {
        let restRawRecord: string = rawRecord;
        const [rawTimestamp, modelId, rawResponseStatus, afterIntroRawRecord] =
            this.parseFirstLineByRegex(
                this.introLinePattern,
                restRawRecord,
                "intro line"
            );
        const timestampMillis = this.parseTimestampMillis(rawTimestamp);
        const responseStatus = this.parseAsType<ResponseStatus>(
            rawResponseStatus,
            "response status"
        );
        restRawRecord = afterIntroRawRecord;

        let error: LoggedError | undefined = undefined;
        if (restRawRecord.startsWith("!")) {
            const [errorTypeName, rawErrorMessage, afterLoggedErrorRawRecord] =
                this.parseFirstLineByRegex(
                    this.loggedErrorPattern,
                    restRawRecord,
                    "logged error"
                );
            error = {
                typeName: errorTypeName,
                message: LoggerRecord.unescapeNewlines(rawErrorMessage),
            };
            restRawRecord = afterLoggedErrorRawRecord;
        }

        const [rawChoices, afterChoicesRawRecord] = this.parseFirstLineByRegex(
            this.choicesPattern,
            restRawRecord,
            "requested choices"
        );
        const [rawTokens, afterTokensRawRecord] = this.parseFirstLineByRegex(
            this.requestTokensPattern,
            afterChoicesRawRecord,
            "request's tokens"
        );
        restRawRecord = afterTokensRawRecord;

        return [
            new LoggerRecord(
                timestampMillis,
                modelId,
                responseStatus,
                this.parseIntValue(rawChoices, "requested choices"),
                this.parseIntValueOrUndefined(rawTokens, "request's tokens"),
                error
            ),
            restRawRecord,
        ];
    }

    protected static splitByFirstLine(text: string): [string, string] {
        const firstLineEndIndex = text.indexOf("\n");
        if (firstLineEndIndex === -1) {
            throw new ParsingError("line expected", text);
        }
        return [
            text.substring(0, firstLineEndIndex),
            text.substring(firstLineEndIndex + 1),
        ];
    }

    protected static parseAsType<T>(rawValue: string, valueName: string): T {
        const parsedValue = rawValue as T;
        if (parsedValue === null) {
            throw new ParsingError(`invalid ${valueName}`, rawValue);
        }
        return parsedValue;
    }

    protected static parseTimestampMillis(rawTimestamp: string): number {
        try {
            return new Date(rawTimestamp).getTime();
        } catch (e) {
            throw new ParsingError("invalid timestampt", rawTimestamp);
        }
    }

    protected static parseIntValue(
        rawValue: string,
        valueName: string
    ): number {
        try {
            return parseInt(rawValue);
        } catch (e) {
            throw new ParsingError(`invalid ${valueName}`, rawValue);
        }
    }

    protected static parseIntValueOrUndefined(
        rawValue: string,
        valueName: string
    ): number | undefined {
        if (rawValue === "undefined") {
            return undefined;
        }
        return this.parseIntValue(rawValue, valueName);
    }

    protected static parseByRegex(
        pattern: RegExp,
        text: string,
        valueName: string
    ): RegExpMatchArray {
        const match = text.match(pattern);
        if (!match) {
            throw new ParsingError(`invalid ${valueName}`, text);
        }
        return match;
    }

    protected static parseFirstLineByRegex(
        pattern: RegExp,
        text: string,
        valueName: string
    ): string[] {
        const [firstLine, restText] = this.splitByFirstLine(text);
        const parsedLine = this.parseByRegex(pattern, firstLine, valueName);
        return [...parsedLine.slice(1), restText];
    }

    protected static unescapeNewlines(text: string): string {
        return text.replace("\\n", "\n");
    }
}

export class DebugLoggerRecord extends LoggerRecord {
    constructor(
        baseRecord: LoggerRecord,
        readonly chat: ChatHistory | undefined,
        readonly params: ModelParams,
        readonly generatedProofs: string[] | undefined = undefined
    ) {
        super(
            baseRecord.timestampMillis,
            baseRecord.modelId,
            baseRecord.responseStatus,
            baseRecord.choices,
            baseRecord.estimatedTokens,
            baseRecord.error
        );
    }

    protected static subItemDelim = "\t> ";
    protected static jsonStringifyIndent = 2;

    serializeToString(): string {
        const baseInfo = super.serializeToString();
        const extraInfo = this.buildExtraInfo();
        return `${baseInfo}${extraInfo}`;
    }

    private buildExtraInfo(): string {
        const chatInfo =
            this.chat !== undefined
                ? `- chat sent:\n${this.chatToExtraLogs()}\n`
                : "";
        const generatedProofs =
            this.generatedProofs !== undefined
                ? `- generated proofs:\n${this.proofsToExtraLogs()}\n`
                : "";
        const paramsInfo = `- model's params:\n${this.paramsToExtraLogs()}\n`;
        return `${chatInfo}${generatedProofs}${paramsInfo}`;
    }

    private chatToExtraLogs(): string {
        return this.chat!.map(
            (message) =>
                `${DebugLoggerRecord.subItemDelim}[${message.role}]: \`${LoggerRecord.escapeNewlines(message.content)}\``
        ).join("\n");
    }

    private proofsToExtraLogs(): string {
        return this.generatedProofs!.map(
            (proof) =>
                `${DebugLoggerRecord.subItemDelim}\`${LoggerRecord.escapeNewlines(proof)}\``
        ).join("\n");
    }

    private paramsToExtraLogs(): string {
        return JSON.stringify(
            this.params,
            null,
            DebugLoggerRecord.jsonStringifyIndent
        );
    }

    protected static chatHeaderPattern = /^- chat sent:$/;
    protected static chatHeader = "- chat sent:";
    protected static chatMessagePattern = /^\t> \[(.*)\]: `(.*)`$/;

    protected static generatedProofsHeaderPattern = /^- generated proofs:$/;
    protected static generatedProofsHeader = "- generated proofs:";
    protected static generatedProofPattern = /^\t> `(.*)`$/;

    protected static paramsHeaderPattern = /^- model's params:$/;

    static deserealizeFromString(
        rawRecord: string
    ): [DebugLoggerRecord, string] {
        const [baseRecord, afterBaseRawRecord] = super.deserealizeFromString(
            rawRecord
        );
        const [chat, afterChatRawRecord] = this.parseOptional(
            this.chatHeader,
            (text) => this.parseChatHistory(text),
            afterBaseRawRecord
        );
        const [generatedProofs, afterProofsRawRecord] = this.parseOptional(
            this.generatedProofsHeader,
            (text) => this.parseGeneratedProofs(text),
            afterChatRawRecord
        );
        const [params, unparsedData] =
            this.parseModelParams(afterProofsRawRecord);

        return [
            new DebugLoggerRecord(baseRecord, chat, params, generatedProofs),
            unparsedData,
        ];
    }

    protected static parseOptional<T>(
        header: string,
        parse: (text: string) => [T, string],
        text: string
    ): [T | undefined, string] {
        if (!text.startsWith(header)) {
            return [undefined, text];
        }
        return parse(text);
    }

    private static parseChatHistory(text: string): [ChatHistory, string] {
        let [restRawRecord] = this.parseFirstLineByRegex(
            this.chatHeaderPattern,
            text,
            "chat history header"
        );
        const chat: ChatHistory = [];
        while (restRawRecord.startsWith(this.subItemDelim)) {
            const [rawRole, rawContent, newRestRawRecord] =
                this.parseFirstLineByRegex(
                    this.chatMessagePattern,
                    restRawRecord,
                    "chat history's message"
                );
            chat.push({
                role: this.parseAsType<ChatRole>(rawRole, "chat role"),
                content: this.unescapeNewlines(rawContent),
            });
            restRawRecord = newRestRawRecord;
        }
        return [chat, restRawRecord];
    }

    private static parseGeneratedProofs(text: string): [string[], string] {
        let [restRawRecord] = this.parseFirstLineByRegex(
            this.generatedProofsHeaderPattern,
            text,
            "generated proofs header"
        );
        const generatedProofs = [];
        while (restRawRecord.startsWith(this.subItemDelim)) {
            const [rawGeneratedProof, newRestRawRecord] =
                this.parseFirstLineByRegex(
                    this.generatedProofPattern,
                    restRawRecord,
                    "generated proof"
                );
            generatedProofs.push(this.unescapeNewlines(rawGeneratedProof));
            restRawRecord = newRestRawRecord;
        }
        return [generatedProofs, restRawRecord];
    }

    private static parseModelParams(text: string): [ModelParams, string] {
        let [restRawRecord] = this.parseFirstLineByRegex(
            this.paramsHeaderPattern,
            text,
            "model's params header"
        );
        const params = this.parseAsType<ModelParams>(
            JSON.parse(restRawRecord),
            "model's params"
        );

        restRawRecord = restRawRecord.slice(
            JSON.stringify(params, null, this.jsonStringifyIndent).length
        );
        if (!restRawRecord.startsWith("\n")) {
            throw new ParsingError(
                `invalid model's params suffix`,
                restRawRecord
            );
        }
        restRawRecord = restRawRecord.slice(1);

        return [params, restRawRecord];
    }
}
