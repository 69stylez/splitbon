/** Never notify the group or navigate away before the editor draft has been persisted. */
export async function startSavedClaimRequest(
  saveDraft: () => Promise<unknown>,
  startRequest: () => Promise<unknown>,
): Promise<void> {
  await saveDraft();
  await startRequest();
}
