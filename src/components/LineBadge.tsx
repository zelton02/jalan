import { lineNames } from "../data/lines";
import type { LineId } from "../types";

export default function LineBadge({ line, short }: { line: LineId; short?: string }) {
  return (
    <span className={`badge badge--${line}`} title={lineNames[line]}>
      {short ?? lineNames[line]}
    </span>
  );
}
