import {
    TextEditor,
    ExtensionContext,
    commands,
    Uri,
    Position as VSPos,
} from "vscode";

import {
    BaseLanguageClient,
    RequestType,
    VersionedTextDocumentIdentifier,
    DocumentSymbolRequest,
    Disposable,
    DocumentSymbolParams,
    DocumentSymbol,
    Range,
    Position,
    DidOpenTextDocumentNotification,
    DidOpenTextDocumentParams,
    LogTraceNotification,
    ProtocolNotificationType,
    DidChangeTextDocumentParams,
    PublishDiagnosticsNotification,
    DidChangeTextDocumentNotification,
    SetTraceNotification,
    SetTraceParams,
    Diagnostic
} from "vscode-languageclient";

import { 
    readFileSync, 
    openSync, 
    closeSync, 
    existsSync,
    unlinkSync, 
    writeFileSync, 
    appendFileSync, 
} from "fs";

import { GoalRequest, GoalAnswer, PpString, hypToString } from "../lib/types";

interface ProofViewInterface {
    /**
     * Calls coq-lsp at current cursor position to retrieve goals, 
     * formats them as an auxiliary theorem, and returns it.
     * @param editor The editor to retrieve goals from
     * @returns The auxiliary theorem and its start position
     */
    getAuxTheoremAtCurPosition(
        uri: Uri, 
        version: number, 
        position: Position
    ): Promise<string | undefined>;

    /**
     * Takes an array of `{ ${proofWithoutProofAndQed} }` strings, for each proof,
     * inserts it into the end of the file, and check for errors.
     * @param uri The uri of the aux document
     * @param theoremsWithProofs The array of proofs
     * @returns An array of tuples, each tuple contains a boolean and an error message, if any.
     * Invariant: the length of the returned array is <= the length of `theoremWithProofs`.
     * The array either contains all `false` or < `theoremWithProofs.length` `false` values 
     * and one `true` value.
     */
    checkTheorems(
        uri: Uri, 
        theoremsWithProofs: string[]
    ): Promise<[boolean, string | null][]>;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const goalReq = new RequestType<GoalRequest, GoalAnswer<PpString>, void>(
    "proof/goals"
);
  
export class ProofView implements ProofViewInterface, Disposable {
    private client: BaseLanguageClient;
    private pendingProgress: boolean;
    private pendingDiagnostic: boolean;
    private awaitedDiagnostic: Diagnostic[] | null;

    constructor(client: BaseLanguageClient, context: ExtensionContext) {
        this.client = client;

        this.setTrace("verbose");

        function solverCommand(command: string, fn: (editor: TextEditor) => void) {
            let disposable = commands.registerTextEditorCommand(
                "coqpilot." + command,
                fn
            );
            context.subscriptions.push(disposable);
        }

        solverCommand("get_document", this.runGeneration.bind(this));
    }

    async getDocument(uri: Uri) {
        const params: DocumentSymbolParams = {
            textDocument: {
                uri: uri.toString()
            }
        };
        const response = await this.client.sendRequest(DocumentSymbolRequest.type, params);
        return response;
    }

    getTheoremClosestToPosition(
        position: Position, 
        document: DocumentSymbol[]
    ): [string, Position] | undefined {
        function isPositionAfterRangeStart(position: Position, range: Range): boolean {
            return range.start.line <= position.line && range.start.character <= position.character;
        };

        // Find closest theorem before the cursor
        let left = 0;
        let right = document.length - 1;
        let closestTheorem: DocumentSymbol | undefined = undefined;
        while (left <= right) {
            let mid = Math.floor((left + right) / 2);
            if (isPositionAfterRangeStart(position, document[mid].range)) {
                closestTheorem = document[mid];
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        if (!closestTheorem) {
            return undefined;
        }

        return [closestTheorem.name, closestTheorem.range.start];
    }

    async getAuxTheoremAtCurPosition(
        uri: Uri, 
        version: number, 
        position: Position
    ): Promise<string | undefined> {
        const goals = await this.client.sendRequest(goalReq, {
            textDocument: VersionedTextDocumentIdentifier.create(
                uri.toString(),
                version
            ),
            position,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            pp_format: "Str",
        });
        
        const goal = goals?.goals?.goals?.shift() ?? undefined;
        if (!goal) {
            return undefined;
        }

        const auxTheoremConcl = goal?.ty;
        const theoremIndeces = goal?.hyps.map(hyp => `(${hypToString(hyp)})`).join(' ');
        const coqDoc = await this.getDocument(uri);
        const res = this.getTheoremClosestToPosition(position, coqDoc as DocumentSymbol[]); 
        if (!res) {
            return undefined;
        }

        const [thrName, _] = res;
        const auxTheoremStatement = `Lemma ${thrName}_aux_thr ${theoremIndeces} :\n   ${auxTheoremConcl}.`;

        return auxTheoremStatement;
    }

    /**
     * Makes arbitrary document-change request to the coq-lsp client, then actively waits for
     * the coq-lsp to re-typecheck it. This function assumes that coq-lsp first sends 
     * "document fully" checked logtrace notification, and then sends final diagnostics.
     * TODO: "document fully checked" logtrace notification does not contain the uri of
     * the corresponding document, so, if there are multiple documents open there may occure 
     * a situation when when we accidently catch the other document's notification and 
     * after that start assuming its fully checked. 
     * For more garanties, I have added a check that the checked document is the same size
     * as the original one, but, anyways, this should be fixed in the future.
     * Maybe open a new-feature issue for coq-lsp
     * @param requestType Type of the request
     * @param params Params of the request 
     * @param uri Uri of the document we are changing 
     * @param lineNum Number of lines in this document
     * @param timeout Timeout in milliseconds
     * @returns An array of diagnostics, if any, otherwise []
     */
    async updateWithWait(
        requestType: ProtocolNotificationType<any, any>,
        params: any, 
        uri: Uri,
        lineNum: number,
        timeout: number = 50000,
    ): Promise<Diagnostic[]> {
        await this.client.sendNotification(requestType, params);

        this.pendingProgress = true;
        this.pendingDiagnostic = true;
        this.awaitedDiagnostic = null;

        this.client.onNotification(LogTraceNotification.type, (params) => {
            if (params.message.includes("document fully checked") && params.message.includes(`l: ${lineNum}`)) {
                this.pendingProgress = false;
            }
        }); 

        this.client.onNotification(PublishDiagnosticsNotification.type, (params) => {
            if (params.uri.toString() === uri.toString()) {
                this.pendingDiagnostic = false;
                this.awaitedDiagnostic = params.diagnostics;
            }
        });

        while (timeout > 0 && (this.pendingProgress || this.pendingDiagnostic)) {
            await sleep(100);
            timeout -= 100;
        }

        if (
            timeout <= 0 || 
            this.pendingProgress || 
            this.pendingDiagnostic || 
            this.awaitedDiagnostic === null
        ) {
            throw new Error("Coq-lsp did not respond in time");
        }

        return this.awaitedDiagnostic;
    }

    /**
     * Used to determine which diagnostics correspond to the theorem
     * we are interested in.
     * @param diagnostics An array of diagnostics
     * @param position The position to filter diagnostics by
     * @returns The first diagnostic's message that is after the given 
     * position or null if there is none
     */
    filterDiagnostics(diagnostics: Diagnostic[], position: Position): string | null {
        return diagnostics.filter(diag => diag.range.start.line >= position.line)
                          .filter(diag => diag.severity === 1) // 1 is error
                          .shift()?.message?.split('\n').shift() ?? null;
    }

    private setTrace(level: "off" | "messages" | "verbose") {
        const params: SetTraceParams = {
            value: level
        };
        this.client.sendNotification(SetTraceNotification.type, params);
    }

    private makeAuxfname(uri: Uri): Uri {
        let auxFilePath = uri.fsPath.replace(/\.v$/, "_cp_aux.v");
        if (existsSync(auxFilePath)) {
            const randomSuffix = Math.floor(Math.random() * 1000000);
            auxFilePath = auxFilePath.replace(/\_cp_aux.v$/, `_${randomSuffix}_cp_aux.v`);
        }
        
        return Uri.file(auxFilePath);
    }

    private async copyAndOpenFile(oldText: string, newUri: Uri, position: VSPos) {
        // Get the text before the cursor
        const oldTextBeforeCursorLines = oldText.split("\n").slice(0, position.line + 1);
        oldTextBeforeCursorLines[position.line] = oldTextBeforeCursorLines[position.line].slice(0, position.character);
        let docText = oldTextBeforeCursorLines.join("\n");

        // TODO: Not needed anymore? 
        // docText += " clear. ";

        const lineCount = docText.split("\n").length - 1;

        // Open new one
        const fd = openSync(newUri.fsPath, "w");
        // Copy to it the contents of the old file
        writeFileSync(fd, docText);
        // Close the file
        closeSync(fd);
 
        // Request lsp to open the new file
        const params: DidOpenTextDocumentParams = {
            textDocument: {
                uri: newUri.toString(),
                languageId: "coq",
                version: 1,
                text: docText
            }
        };

        await this.updateWithWait(DidOpenTextDocumentNotification.type, params, newUri, lineCount);
    }

    private thrProofToBullet(proof: string): string {
        // Remove "Proof." and "Qed."
        let res = proof.replace(/Proof using\./g, '')
                       .replace(/Proof\./g, '')
                       .replace(/Qed\./g, '');

        return `{ ${res} }`;
    }

    async runGeneration(editor: TextEditor) {
        const auxFile = this.makeAuxfname(editor.document.uri);
        const cursorPos = editor.selection.active;
        await this.copyAndOpenFile(editor.document.getText(), auxFile, cursorPos);

        const thr = await this.getAuxTheoremAtCurPosition(auxFile, 1, cursorPos);
        if (!thr) {
            console.log("No goal at cursor");
            return;
        }

        // Use this aux theorem to generate a proofs .
        // ... here mock 
        const proofs = [
            "Proof. simpl. Qed.",
            "Proof. reflexivity. Qed.",
            "Proof. kek. Qed.",
            "Proof. auto. Qed.",
            "Proof using. destruct n; [left|right]; lia. Qed."
        ];
        const proofsProcessed = proofs.map(this.thrProofToBullet);

        const verdicts = await this.checkTheorems(auxFile, proofsProcessed);

        console.log("VERDICTS", verdicts);
    }

    async checkTheorems(
        uri: Uri, 
        theoremsWithProofs: string[]
    ): Promise<[boolean, string | null][]> {
        let documentVersion = 1;

        // Open the file and read the context
        const context = readFileSync(uri.fsPath).toString();
        const lineNumContext = context.split("\n").length - 1;

        const proofVerdicts: [boolean, string | null][] = [];

        for (const proof of theoremsWithProofs) {
            const prohibitedTactics = ["admit.", "Admitted.", "Abort."];
            if (prohibitedTactics.some(tactic => proof.includes(tactic))) {
                proofVerdicts.push([false, "Proof contains 'Abort.' or 'Admitted.'"]);
                continue;
            }
            
            documentVersion += 1;

            // Append the proof to the end of the file
            appendFileSync(uri.fsPath, proof);

            // Notify the server about the change
            const versionedDoc = VersionedTextDocumentIdentifier.create(
                uri.toString(),
                documentVersion
            );

            const newText = context + proof;
            const params: DidChangeTextDocumentParams = {
                textDocument: versionedDoc,
                contentChanges: [{
                    text: newText
                }]
            };

            const newLineNum = newText.split("\n").length - 1;
            const diags = await this.updateWithWait(DidChangeTextDocumentNotification.type, params, uri, newLineNum);

            // Filter diagnostics by the line number of the context
            const errorMsg = this.filterDiagnostics(diags, { line: lineNumContext, character: 0 });

            // Remove the proof from the end of the file
            writeFileSync(uri.fsPath, context);

            if (errorMsg === null) {
                proofVerdicts.push([true, null]);
                unlinkSync(uri.fsPath);
                return proofVerdicts;
            } else {
                proofVerdicts.push([false, errorMsg]);
            }
        }

        // Delete aux file
        unlinkSync(uri.fsPath);

        return proofVerdicts;
    }

    dispose(): void {
        this.client.dispose();
    }

}