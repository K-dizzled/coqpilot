import { Goal, PpString } from "../../coqLsp/coqLspTypes";

import { hypToString } from "../../utils/printers";

export function goalAsTheoremString(proofGoal: Goal<PpString>): string {
    const auxTheoremConcl = proofGoal?.ty;
    const theoremIndeces = proofGoal?.hyps
        .map((hyp) => `(${hypToString(hyp)})`)
        .join(" ");
    return `${theoremIndeces} # ${auxTheoremConcl}.`;
}
