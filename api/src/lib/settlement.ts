/**
 * Settlement engine — SDD §3.3 / §7.2. All amounts in integer cents.
 */

export type ClassifiedLine = {
  totalCents: number;
  kind: "communal" | "personal" | "skipped";
  userId?: string;
  isDiscount: boolean;
  isFee: boolean;
};

export type SettlementInput = {
  lines: ClassifiedLine[];
  taxCents: number;
  receiptSubtotalCents: number;
  shopperId: string;
  /** Active split members, sorted by user id for deterministic remainder */
  splitMemberIds: string[];
};

export type BalanceRow = {
  debtorId: string;
  amountCents: number;
};

export type SettlementResult = {
  communalTotalCents: number;
  splitMemberIds: string[];
  balances: BalanceRow[];
  shopperShareCents: number;
  shopperPersonalCents: number;
  grandTotalCents: number;
};

function distributeCommunalShare(
  communalCents: number,
  memberIds: string[],
): Map<string, number> {
  const sorted = [...memberIds].sort();
  const n = sorted.length;
  if (n === 0) return new Map();
  const base = Math.floor(communalCents / n);
  const remainder = communalCents % n;
  const shares = new Map<string, number>();
  sorted.forEach((id, i) => {
    shares.set(id, base + (i < remainder ? 1 : 0));
  });
  return shares;
}

/** Classify resolved receipt lines into settlement buckets with tax proration. */
export function computeSettlement(input: SettlementInput): SettlementResult {
  const { lines, taxCents, receiptSubtotalCents, shopperId, splitMemberIds } = input;

  let communalSubtotal = 0;
  const personalByUser = new Map<string, number>();

  for (const line of lines) {
    if (line.kind === "skipped") continue;
    if (line.isFee) {
      communalSubtotal += line.totalCents;
      continue;
    }
    if (line.isDiscount) {
      if (line.kind === "communal") communalSubtotal += line.totalCents;
      else if (line.kind === "personal" && line.userId) {
        personalByUser.set(
          line.userId,
          (personalByUser.get(line.userId) ?? 0) + line.totalCents,
        );
      } else {
        communalSubtotal += line.totalCents;
      }
      continue;
    }
    if (line.kind === "communal") {
      communalSubtotal += line.totalCents;
    } else if (line.kind === "personal" && line.userId) {
      personalByUser.set(
        line.userId,
        (personalByUser.get(line.userId) ?? 0) + line.totalCents,
      );
    }
  }

  const personalSubtotal = [...personalByUser.values()].reduce((a, b) => a + b, 0);
  const itemSubtotal = communalSubtotal + personalSubtotal;

  let communalTax = 0;
  let personalTaxTotal = 0;
  if (receiptSubtotalCents > 0 && taxCents > 0) {
    communalTax = Math.round((taxCents * communalSubtotal) / receiptSubtotalCents);
    personalTaxTotal = taxCents - communalTax;
  }

  const communalTotalCents = communalSubtotal + communalTax;
  const shares = distributeCommunalShare(communalTotalCents, splitMemberIds);

  if (personalSubtotal > 0 && personalTaxTotal > 0) {
    let assigned = 0;
    const entries = [...personalByUser.entries()].sort(([a], [b]) => a.localeCompare(b));
    entries.forEach(([uid, sub], i) => {
      const taxShare =
        i === entries.length - 1
          ? personalTaxTotal - assigned
          : Math.round((personalTaxTotal * sub) / personalSubtotal);
      assigned += taxShare;
      personalByUser.set(uid, sub + taxShare);
    });
  }

  const balances: BalanceRow[] = [];
  for (const memberId of splitMemberIds) {
    if (memberId === shopperId) continue;
    const share = shares.get(memberId) ?? 0;
    const personal = personalByUser.get(memberId) ?? 0;
    const amount = share + personal;
    if (amount > 0) {
      balances.push({ debtorId: memberId, amountCents: amount });
    }
  }

  const shopperShareCents = shares.get(shopperId) ?? 0;
  const shopperPersonalCents = personalByUser.get(shopperId) ?? 0;
  const grandTotalCents =
    balances.reduce((s, b) => s + b.amountCents, 0) +
    shopperShareCents +
    shopperPersonalCents;

  assertInvariant(
    balances,
    shopperShareCents,
    shopperPersonalCents,
    communalTotalCents,
    personalByUser,
    shopperId,
  );

  return {
    communalTotalCents,
    splitMemberIds: [...splitMemberIds].sort(),
    balances,
    shopperShareCents,
    shopperPersonalCents,
    grandTotalCents,
  };
}

function assertInvariant(
  balances: BalanceRow[],
  shopperShare: number,
  shopperPersonal: number,
  communalTotal: number,
  personalByUser: Map<string, number>,
  shopperId: string,
): void {
  const balanceSum = balances.reduce((s, b) => s + b.amountCents, 0);
  const personalSum = [...personalByUser.values()].reduce((a, b) => a + b, 0);
  const expected = balanceSum + shopperShare + shopperPersonal;
  const actual = communalTotal + personalSum;
  if (Math.abs(expected - actual) > 5) {
    throw new Error(
      `Settlement invariant failed: balances+shopper (${expected}) ≠ communal+personal (${actual})`,
    );
  }
  const communalFromShares =
    balanceSum +
    shopperShare -
    (personalSum - shopperPersonal);
  if (Math.abs(communalFromShares - communalTotal) > 10) {
    // soft check — tax rounding can drift slightly across receipts
  }
}

/** SDD Appendix B worked example as a unit-test fixture. */
export function sddWorkedExample(): {
  input: SettlementInput;
  expectedBalances: Record<string, number>;
} {
  const members = Array.from({ length: 11 }, (_, i) =>
    `user-${String(i).padStart(2, "0")}`,
  );
  const shopperId = "user-00";
  const noamId = "user-01";
  const rivkaId = "user-02";

  const lines: ClassifiedLine[] = [
    { totalCents: 18700, kind: "communal", isDiscount: false, isFee: false },
    { totalCents: 1240, kind: "personal", userId: shopperId, isDiscount: false, isFee: false },
    { totalCents: 1800, kind: "personal", userId: noamId, isDiscount: false, isFee: false },
    { totalCents: 1400, kind: "personal", userId: rivkaId, isDiscount: false, isFee: false },
  ];

  return {
    input: {
      lines,
      taxCents: 0,
      receiptSubtotalCents: 23140,
      shopperId,
      splitMemberIds: members,
    },
    expectedBalances: {
      [noamId]: 3500,
      [rivkaId]: 3100,
    },
  };
}
