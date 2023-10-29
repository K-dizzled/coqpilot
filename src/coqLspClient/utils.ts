import {
    Uri,
    Position as VPosition,
} from 'vscode';

import {
    Position,
} from "vscode-languageclient";

import {
    existsSync,
} from 'fs';

export function makeAuxfname(uri: Uri, unique: boolean = false): Uri {
    let auxFilePath = uri.fsPath.replace(/\.v$/, "_cp_aux.v");
    if (unique && existsSync(auxFilePath)) {
        const randomSuffix = Math.floor(Math.random() * 1000000);
        auxFilePath = auxFilePath.replace(/\_cp_aux.v$/, `_${randomSuffix}_cp_aux.v`);
    }
    
    return Uri.file(auxFilePath);
}

export function getTextBeforePosition(text: string, position: VPosition): string {
    // Get the text before the cursor
    const oldTextBeforeCursorLines = text.split("\n").slice(0, position.line + 1);
    oldTextBeforeCursorLines[position.line] = oldTextBeforeCursorLines[position.line].slice(0, position.character);
    return oldTextBeforeCursorLines.join("\n");
}

export function toVPosition(position: Position): VPosition {
    return new VPosition(position.line, position.character);
}