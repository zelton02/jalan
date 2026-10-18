import { lineNames, type LineId } from "../data/routes";

export default function LineBadge({ line, short }: { line: LineId; short?: string }) {
  return (
    <span className={`badge badge--${line}`} title={lineNames[line]}>
      {short ?? lineNames[line]}
    </span>
  );
}
