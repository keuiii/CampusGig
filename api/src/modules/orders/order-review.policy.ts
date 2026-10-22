export const orderReviewPolicyVersion = 1;
export const orderReviewWindowMilliseconds = 48 * 60 * 60 * 1_000;

export function orderReviewWindow(submittedAt: Date) {
  const reviewStartedAt = new Date(submittedAt);
  const reviewDeadlineAt = new Date(
    reviewStartedAt.getTime() + orderReviewWindowMilliseconds,
  );
  return { reviewStartedAt, reviewDeadlineAt };
}

export function isOrderReviewExpired(deadline: Date, now: Date) {
  return now.getTime() >= deadline.getTime();
}

export function earningAvailableReleaseSourceKey(earningId: string) {
  return `earning:${earningId}:available-release`;
}
