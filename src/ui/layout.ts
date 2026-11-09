import Yoga, { Direction, FlexDirection } from "yoga-layout";

export interface ScreenSlots {
  scroll: number;
  debug: number;
  status: number;
  mention: number;
  input: number;
}

const debugRows = 12;
const statusRows = 1;
const inputRows = 4;

/**
 * Row budget for the screen. Ink lays the same rows out again; this pass is
 * the one the scroll window trusts, so page-up and the frame agree.
 */
export function measureScreen(width: number, height: number, debug: boolean, mention = 0): ScreenSlots {
  const plan: Array<{ name: keyof ScreenSlots; row: Row }> = [{ name: "scroll", row: { grow: 1, min: 1 } }];
  if (debug) plan.push({ name: "debug", row: { height: debugRows, shrink: 1, min: 1 } });
  plan.push({ name: "status", row: { height: statusRows, shrink: 0 } });
  if (mention > 0) plan.push({ name: "mention", row: { height: mention, shrink: 1, min: 3 } });
  plan.push({ name: "input", row: { height: inputRows, shrink: 0 } });
  const heights = column(width, height, plan.map((item) => item.row));
  const slots: ScreenSlots = { scroll: 1, debug: 0, status: statusRows, mention: 0, input: inputRows };
  plan.forEach((item, index) => {
    slots[item.name] = heights[index] ?? 0;
  });
  return slots;
}

/** Prompt, rule, flexible diff, spacer, and the y/n hint. */
export function measureModal(width: number, height: number): { body: number } {
  const heights = column(width, height, [
    { height: 1, shrink: 0 },
    { height: 1, shrink: 0 },
    { grow: 1, min: 1 },
    { height: 1, shrink: 0 },
    { height: 1, shrink: 0 },
  ]);
  return { body: heights[2] ?? 1 };
}

interface Row {
  grow?: number;
  height?: number;
  shrink?: number;
  min?: number;
}

function column(width: number, height: number, rows: Row[]): number[] {
  const root = Yoga.Node.create();
  const children = rows.map((row, index) => {
    const node = Yoga.Node.create();
    if (row.grow) node.setFlexGrow(row.grow);
    if (row.height !== undefined) node.setHeight(row.height);
    if (row.shrink !== undefined) node.setFlexShrink(row.shrink);
    if (row.min !== undefined) node.setMinHeight(row.min);
    root.insertChild(node, index);
    return node;
  });
  try {
    root.setWidth(width);
    root.setHeight(height);
    root.setFlexDirection(FlexDirection.Column);
    root.calculateLayout(width, height, Direction.LTR);
    return children.map((node) => Math.max(0, Math.floor(node.getComputedHeight())));
  } finally {
    root.freeRecursive();
  }
}
