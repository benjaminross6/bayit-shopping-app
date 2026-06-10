import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeSettlement,
  sddWorkedExample,
  type ClassifiedLine,
} from "./settlement.js";

function balanceMap(balances: { debtorId: string; amountCents: number }[]) {
  return Object.fromEntries(balances.map((b) => [b.debtorId, b.amountCents]));
}

describe("computeSettlement", () => {
  it("SDD Appendix B worked example", () => {
    const { input, expectedBalances } = sddWorkedExample();
    const result = computeSettlement(input);
    const map = balanceMap(result.balances);

    assert.equal(result.communalTotalCents, 18700);
    assert.equal(map["user-01"], expectedBalances["user-01"]);
    assert.equal(map["user-02"], expectedBalances["user-02"]);

    const otherMembers = input.splitMemberIds.filter(
      (id) => id !== input.shopperId && id !== "user-01" && id !== "user-02",
    );
    for (const id of otherMembers) {
      assert.equal(map[id], 1700, `${id} should owe $17 communal share`);
    }
    assert.equal(map[input.shopperId], undefined, "shopper not billed");

    assert.equal(result.shopperPersonalCents, 1240);
    assert.equal(result.shopperShareCents, 1700);
  });

  it("distributes communal remainder cents deterministically by sorted user id", () => {
    const members = ["user-b", "user-a", "user-c"];
    const result = computeSettlement({
      lines: [{ totalCents: 100, kind: "communal", isDiscount: false, isFee: false }],
      taxCents: 0,
      receiptSubtotalCents: 100,
      shopperId: "shopper",
      splitMemberIds: members,
    });
    const map = balanceMap(result.balances);
    assert.equal(map["user-a"], 34);
    assert.equal(map["user-b"], 33);
    assert.equal(map["user-c"], 33);
    assert.equal(
      result.balances.reduce((s, b) => s + b.amountCents, 0) + result.shopperShareCents,
      100,
    );
  });

  it("single split member gets full communal total", () => {
    const result = computeSettlement({
      lines: [{ totalCents: 5000, kind: "communal", isDiscount: false, isFee: false }],
      taxCents: 0,
      receiptSubtotalCents: 5000,
      shopperId: "shopper",
      splitMemberIds: ["only-one"],
    });
    assert.equal(result.balances.length, 1);
    assert.equal(result.balances[0].amountCents, 5000);
  });

  it("prorates tax between communal and personal subtotals", () => {
    const result = computeSettlement({
      lines: [
        { totalCents: 10000, kind: "communal", isDiscount: false, isFee: false },
        { totalCents: 5000, kind: "personal", userId: "alice", isDiscount: false, isFee: false },
      ],
      taxCents: 1500,
      receiptSubtotalCents: 15000,
      shopperId: "shopper",
      splitMemberIds: ["alice", "bob"],
    });
    assert.equal(result.communalTotalCents, 11000);
    const map = balanceMap(result.balances);
    assert.equal(map["alice"], 5500 + 5500);
    assert.equal(map["bob"], 5500);
  });

  it("fees are communal regardless of line kind", () => {
    const result = computeSettlement({
      lines: [
        { totalCents: 200, kind: "personal", userId: "alice", isDiscount: false, isFee: true },
      ],
      taxCents: 0,
      receiptSubtotalCents: 200,
      shopperId: "shopper",
      splitMemberIds: ["alice", "bob"],
    });
    assert.equal(result.communalTotalCents, 200);
    const map = balanceMap(result.balances);
    assert.equal(map["alice"], 100);
    assert.equal(map["bob"], 100);
  });

  it("discount on communal line reduces communal total", () => {
    const result = computeSettlement({
      lines: [
        { totalCents: 1000, kind: "communal", isDiscount: false, isFee: false },
        { totalCents: -200, kind: "communal", isDiscount: true, isFee: false },
      ],
      taxCents: 0,
      receiptSubtotalCents: 800,
      shopperId: "shopper",
      splitMemberIds: ["a", "b"],
    });
    assert.equal(result.communalTotalCents, 800);
    const map = balanceMap(result.balances);
    assert.equal(map["a"] + map["b"], 800);
  });

  it("skipped lines do not affect totals", () => {
    const result = computeSettlement({
      lines: [
        { totalCents: 500, kind: "skipped", isDiscount: false, isFee: false },
        { totalCents: 1000, kind: "communal", isDiscount: false, isFee: false },
      ],
      taxCents: 0,
      receiptSubtotalCents: 1000,
      shopperId: "shopper",
      splitMemberIds: ["a"],
    });
    assert.equal(result.communalTotalCents, 1000);
    assert.equal(result.balances[0].amountCents, 1000);
  });

  it("satisfies grand-total invariant", () => {
    const lines: ClassifiedLine[] = [
      { totalCents: 4200, kind: "communal", isDiscount: false, isFee: false },
      { totalCents: 900, kind: "personal", userId: "u1", isDiscount: false, isFee: false },
      { totalCents: -100, kind: "communal", isDiscount: true, isFee: false },
    ];
    const result = computeSettlement({
      lines,
      taxCents: 410,
      receiptSubtotalCents: 5000,
      shopperId: "shopper",
      splitMemberIds: ["u1", "u2", "shopper"],
    });
    const personalSum = 900 + Math.round((410 * 900) / 5000);
    const expected =
      result.balances.reduce((s, b) => s + b.amountCents, 0) +
      result.shopperShareCents +
      result.shopperPersonalCents;
    const actual = result.communalTotalCents + personalSum;
    assert.ok(Math.abs(expected - actual) <= 5);
  });
});
