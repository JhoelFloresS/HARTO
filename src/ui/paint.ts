import "./force-color.ts";

import { createElement } from "react";
import { renderToString } from "ink";

import { TuiScreen } from "./screen.ts";
import type { TuiModel } from "./tui.ts";

/** One Ink frame, for tests. No terminal and no stdin listener. */
export function paint(model: TuiModel): string {
  return renderToString(createElement(TuiScreen, { model }), { columns: model.width });
}
