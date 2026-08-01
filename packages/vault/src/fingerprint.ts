// Section 3: "the UI shows only a masked fingerprint (`sk-...4f2a`) forever
// after." Computed once at store/rotate time from plaintext, then persisted
// on the record — nothing ever needs to re-decrypt just to show this.
export function maskFingerprint(plaintext: Buffer): string {
  const str = plaintext.toString("utf8");
  if (str.length <= 7) return "***"; // too short to safely reveal any of it
  const prefix = str.slice(0, 3);
  const last4 = str.slice(-4);
  return `${prefix}...${last4}`;
}
