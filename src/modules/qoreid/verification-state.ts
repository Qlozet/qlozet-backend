import { VerificationState } from '../business/schemas/business.schema';

/** One stored check verdict — only `status` matters for the state machine. */
type Verdict = { status?: string } | null | undefined;

const passed = (verdict: Verdict): boolean => verdict?.status === 'verified';

/**
 * States an admin owns. Once a business is in one of these, nothing a provider
 * reports may move it: re-running a check must not pull a business out of the
 * review queue, undo an approval, or revive a rejection.
 */
const ADMIN_OWNED: string[] = [
  VerificationState.AWAITING_REVIEW,
  VerificationState.APPROVED,
  VerificationState.REJECTED,
];

/**
 * The state a business should be in, given the checks that have passed.
 *
 * Returns null when nothing should change — including when the state is
 * already correct, so callers can skip a pointless write.
 *
 * Identity, CAC and NUBAN are always required, because Qlozet onboards
 * registered businesses: identity establishes who the person is, CAC that the
 * company exists, and NUBAN that the payout account is theirs. Any one alone
 * proves too little to let someone take customers' money.
 *
 * LIVENESS is required too, but only for a business that went through the
 * hosted workflow — which is how we know a camera was involved at all. The
 * older per-check endpoints cannot do liveness, so requiring it of them would
 * leave anyone mid-migration permanently unable to finish. The presence of a
 * session is the signal: it is written when a workflow run is minted.
 *
 * Pure, and shared by the per-check endpoints and the workflow webhook, so
 * the two routes into verification can never disagree about what "done" is.
 */
export function nextVerificationState(
  verification: {
    identity?: Verdict;
    business?: Verdict;
    bank?: Verdict;
    liveness?: Verdict;
    session?: unknown;
  } | null | undefined,
  current: string | undefined | null,
): VerificationState | null {
  if (current && ADMIN_OWNED.includes(String(current))) return null;

  const v = verification ?? {};
  const usedWorkflow = Boolean(v.session);
  const complete =
    passed(v.identity) &&
    passed(v.business) &&
    passed(v.bank) &&
    (!usedWorkflow || passed(v.liveness));

  const next = complete
    ? VerificationState.PROVIDER_COMPLETE
    : VerificationState.IN_PROGRESS;

  return next === current ? null : next;
}
