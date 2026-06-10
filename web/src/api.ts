export class ApiFail extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiFail(
      res.status,
      (data.error as string) ?? `Request failed (${res.status})`,
      data.code as string | undefined,
      data.details,
    );
  }
  return data as T;
}

// ---- Shared types (mirror API responses) ----

export type Me = {
  user: {
    id: string;
    email: string;
    displayName: string;
    fullName: string;
    allergens: string[];
    preferences: string;
    venmoHandle: string | null;
    zelleContact: string | null;
  };
  membership: {
    houseId: string;
    isAdmin: boolean;
    isManager: boolean;
    isKitchenHead: boolean;
    active: boolean;
  } | null;
  house: { id: string; name: string } | null;
  profileComplete: boolean;
  allergenOptions: string[];
};

export type Run = {
  id: string;
  state: "draft" | "open" | "locked" | "reconciling" | "settling" | "closed";
  scheduledAt: string | null;
  shopperId: string | null;
  lockedAt?: string | null;
};

export type CurrentRun = {
  run: Run | null;
  itemCounts: Record<string, number>;
  shopper: { id: string; displayName: string } | null;
};

export type ItemState = "pending" | "in_cart" | "purchased" | "archived";

export type Item = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  kind: "communal" | "personal";
  state: ItemState | string;
  notes: string | null;
  storePref: string | null;
  section: string;
  alternatives: string[];
  requesterId: string;
};

export type Store = { id: string; name: string };

export type Requester = { id: string; displayName: string };

export type Duplicate = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  kind: string;
  similarity: number;
};

export type Member = { id: string; displayName: string; email: string };

export type LockResponse = {
  run: Run;
  items: Item[];
  stores: Store[];
  requesters: Record<string, Requester>;
  sections?: string[];
};

export type IssueKind =
  | "out_of_stock"
  | "not_found"
  | "substituted"
  | "price_surprise"
  | "other";

export type SubstituteRequest = {
  id: string;
  itemId: string;
  runId: string;
  status: "pending" | "answered" | "skipped";
  item?: Pick<Item, "id" | "name" | "alternatives">;
  alternatives?: string[];
  createdAt?: string;
};

export type SubstituteResponseKind = "alternative" | "free_text" | "none";

export type Idempotency = { clientId: string; seq: number };

export function isShopper(me: Me, run: Run | null | undefined): boolean {
  if (!run?.shopperId) return false;
  return (
    run.shopperId === me.user.id ||
    !!me.membership?.isAdmin
  );
}

export async function lockRun(runId: string): Promise<LockResponse> {
  const r = await api<{
    ok: boolean;
    run: Run;
    snapshot: {
      items: Array<Item & { requesterDisplayName?: string }>;
      stores: Store[];
      sections: string[];
    };
  }>(`/api/runs/${runId}/lock`, { method: "POST" });

  const requesters: Record<string, Requester> = {};
  const items = r.snapshot.items.map(({ requesterDisplayName, ...item }) => {
    requesters[item.requesterId] = {
      id: item.requesterId,
      displayName: requesterDisplayName ?? "Housemate",
    };
    return item;
  });

  return {
    run: r.run,
    items,
    stores: r.snapshot.stores,
    requesters,
    sections: r.snapshot.sections,
  };
}

export async function doneShopping(runId: string): Promise<{ run: Run }> {
  return api<{ run: Run }>(`/api/runs/${runId}/done-shopping`, { method: "POST" });
}

export async function patchItemState(
  itemId: string,
  state: ItemState,
  idempotency?: Idempotency,
): Promise<{ item: Item }> {
  return api<{ item: Item }>(`/api/items/${itemId}/state`, {
    method: "PATCH",
    body: { state, ...idempotency },
  });
}

export async function subscribePush(
  subscription: PushSubscriptionJSON,
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>("/api/push/subscribe", {
    method: "POST",
    body: {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    },
  });
}

export async function getVapidPublicKey(): Promise<string | null> {
  try {
    const r = await api<{ publicKey: string | null }>("/api/push/vapid-public-key");
    return r.publicKey;
  } catch {
    return null;
  }
}

export async function createSubstituteRequest(
  itemId: string,
  idempotency?: Idempotency,
): Promise<{ request: SubstituteRequest }> {
  return api<{ request: SubstituteRequest }>(`/api/items/${itemId}/substitute-request`, {
    method: "POST",
    body: idempotency ?? {},
  });
}

export async function respondToSubstituteRequest(
  requestId: string,
  responseKind: SubstituteResponseKind,
  responseText?: string,
): Promise<{ request: SubstituteRequest }> {
  return api<{ request: SubstituteRequest }>(`/api/substitute-requests/${requestId}/respond`, {
    method: "POST",
    body: { responseKind, responseText },
  });
}

export async function logRunIssue(
  runId: string,
  payload: { itemId?: string; kind: IssueKind; note?: string } & Partial<Idempotency>,
): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/runs/${runId}/issues`, {
    method: "POST",
    body: payload,
  });
}

export async function fetchPendingSubstituteRequests(): Promise<SubstituteRequest[]> {
  try {
    const r = await api<{ requests: SubstituteRequest[] }>(
      "/api/substitute-requests/pending",
    );
    return r.requests;
  } catch {
    return [];
  }
}

// ---- Receipts + reconciliation ----

export type LineResolution =
  | "auto_matched"
  | "manually_matched"
  | "assigned_communal"
  | "assigned_personal"
  | "skipped";

export type Receipt = {
  id: string;
  runId: string;
  storeId: string | null;
  imagePath: string;
  purchasedAt: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  createdAt: string;
  unresolvedCount?: number;
  integrityWarning?: boolean;
};

export type ReceiptLine = {
  id: string;
  receiptId: string;
  rawText: string;
  parsedName: string;
  quantity: string;
  unitPriceCents: number | null;
  totalCents: number;
  isDiscount: boolean;
  isFee: boolean;
  matchedItemId: string | null;
  matchConfidence: number | null;
  resolution: LineResolution | null;
  resolvedKind: "communal" | "personal" | null;
  resolvedUserId: string | null;
};

export type UnmatchedItem = Item & { requesterDisplayName: string };

export type ReceiptLinesResponse = {
  receipt: Receipt;
  lines: ReceiptLine[];
  unmatchedItems: UnmatchedItem[];
  unresolvedCount: number;
};

export type ChatMessage = { role: "user" | "model"; text: string };

export type AppliedMutation = {
  lineId: string;
  action: string;
  detail: string;
};

export type ReconcileStatus = {
  unresolvedCount: number;
  canFinalize: boolean;
};

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

export async function listReceipts(runId: string): Promise<Receipt[]> {
  const r = await api<{ receipts: Receipt[] }>(`/api/runs/${runId}/receipts`);
  return r.receipts;
}

export async function uploadReceipt(
  runId: string,
  file: File,
): Promise<{ receipt: Receipt; lines: ReceiptLine[]; unresolvedCount: number }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/runs/${runId}/receipts`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiFail(
      res.status,
      (data.error as string) ?? `Upload failed (${res.status})`,
      data.code as string | undefined,
      data.details,
    );
  }
  return data as {
    receipt: Receipt;
    lines: ReceiptLine[];
    unresolvedCount: number;
  };
}

export async function getReceiptLines(receiptId: string): Promise<ReceiptLinesResponse> {
  return api<ReceiptLinesResponse>(`/api/receipts/${receiptId}/lines`);
}

export async function patchReceiptLine(
  lineId: string,
  body: {
    resolution: Exclude<LineResolution, "auto_matched">;
    matchedItemId?: string | null;
    resolvedKind?: "communal" | "personal" | null;
    resolvedUserId?: string | null;
    parsedName?: string;
    totalCents?: number;
  },
): Promise<{ line: ReceiptLine }> {
  return api<{ line: ReceiptLine }>(`/api/receipt-lines/${lineId}`, {
    method: "PATCH",
    body,
  });
}

export async function deleteReceipt(receiptId: string): Promise<void> {
  await api(`/api/receipts/${receiptId}`, { method: "DELETE" });
}

export async function getReconcileStatus(runId: string): Promise<ReconcileStatus> {
  return api<ReconcileStatus>(`/api/runs/${runId}/reconcile-status`);
}

export async function sendReconcileChat(
  receiptId: string,
  message: string,
  history: ChatMessage[],
): Promise<{ reply: string; mutations: AppliedMutation[] }> {
  const r = await api<{ reply: string; mutations: AppliedMutation[] }>(
    `/api/receipts/${receiptId}/chat`,
    { method: "POST", body: { message, history } },
  );
  return r;
}

export async function finalizeRun(runId: string): Promise<{ run: Run }> {
  const r = await api<{ run: Run }>(`/api/runs/${runId}/finalize`, { method: "POST" });
  return r;
}
