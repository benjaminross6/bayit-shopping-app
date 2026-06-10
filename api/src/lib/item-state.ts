import { badRequest } from "./errors.js";

const VALID: Record<string, string[]> = {
  pending: ["in_cart", "archived"],
  in_cart: ["purchased", "archived", "pending"],
  purchased: ["in_cart"],
  archived: [],
};

export function assertItemStateTransition(from: string, to: string): void {
  const allowed = VALID[from];
  if (!allowed?.includes(to)) {
    throw badRequest(`Cannot transition item from '${from}' to '${to}'`);
  }
}

export const SHOP_RUN_STATES = new Set(["locked", "reconciling"]);
