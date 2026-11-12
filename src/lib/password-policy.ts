export interface PasswordPolicyEvaluation {
  minLengthMet: boolean;
  hasLetter: boolean;
  hasNumberOrSymbol: boolean;
  matchesConfirmation: boolean;
  isValid: boolean;
  errorMessage: string | null;
}

const LETTER_REGEX = /[A-Za-z]/;
const NUMBER_OR_SYMBOL_REGEX = /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

/**
 * Evaluates a candidate password against the platform's password policy:
 * - At least 8 characters
 * - At least one letter (A-Z / a-z)
 * - At least one number or symbol
 * - Optional confirmation match
 */
export function evaluatePasswordPolicy(
  password: string,
  confirmPassword?: string | undefined,
): PasswordPolicyEvaluation {
  const minLengthMet = password.length >= 8;
  const hasLetter = LETTER_REGEX.test(password);
  const hasNumberOrSymbol = NUMBER_OR_SYMBOL_REGEX.test(password);
  const matchesConfirmation =
    confirmPassword === undefined ? true : password.length > 0 && password === confirmPassword;

  let errorMessage: string | null = null;
  if (!minLengthMet) {
    errorMessage = "Password must be at least 8 characters.";
  } else if (!hasLetter || !hasNumberOrSymbol) {
    errorMessage = "Password must include at least one letter and one number or symbol.";
  } else if (confirmPassword !== undefined && password !== confirmPassword) {
    errorMessage = "Passwords do not match.";
  }

  return {
    minLengthMet,
    hasLetter,
    hasNumberOrSymbol,
    matchesConfirmation,
    isValid: errorMessage === null,
    errorMessage,
  };
}

