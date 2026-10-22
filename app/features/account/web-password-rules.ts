export type WebPasswordStrength = {
  score: number;
  progress: number;
  label: "" | "Weak" | "Fair" | "Good" | "Strong";
  tone: "empty" | "weak" | "fair" | "good" | "strong";
};

export function evaluateWebPassword(password: string): WebPasswordStrength {
  if (!password) return { score: 0, progress: 0, label: "", tone: "empty" };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password) || password.length >= 12) score += 1;

  if (score <= 1) return { score, progress: 0.25, label: "Weak", tone: "weak" };
  if (score === 2) return { score, progress: 0.5, label: "Fair", tone: "fair" };
  if (score === 3)
    return { score, progress: 0.75, label: "Good", tone: "good" };
  return { score, progress: 1, label: "Strong", tone: "strong" };
}

export function webPasswordConfirmationMatches(
  password: string,
  confirmation: string,
) {
  return confirmation.length > 0 && password === confirmation;
}
