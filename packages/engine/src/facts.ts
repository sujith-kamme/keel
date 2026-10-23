// Facts are gathered by verifier plugins (Phase 2) and snapshotted into the
// ledger with each decision. Money values are PayPal-style decimal strings and
// dates are ISO 8601. Anything missing or malformed makes the decision HOLD.
export interface Facts {
  now: string;
  order?: {
    id: string;
    payer_email: string;
    currency: string;
    captured: string;
    refunded: string;
    captured_at?: string;
    delivered_at?: string;
  };
  identity?: { verified_payer?: string };
  budget?: { session_refunded: string; daily_refunded: string };
  catalog?: { list_price: string; min_price: string };
}
