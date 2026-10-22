import { passwordProblem } from './password';

export const PERSONAL_FRAGMENT_MIN_LENGTH = 4;
export const PREDICTABLE_RUN_MIN_LENGTH = 4;

export interface PasswordOwner {
  email: string;
  name: string;
  serviceNames: string[];
}

const fold = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const compact = (text: string): string =>
  fold(text).replace(/[^\p{L}\p{N}]+/gu, '');

function personalFragments(owner: PasswordOwner): string[] {
  const email = fold(owner.email.trim());
  const localPart = email.split('@', 1)[0] ?? '';
  const nameWords = fold(owner.name).split(/\P{L}+/u);
  const services = owner.serviceNames.map(compact);

  const fragments = [localPart, ...nameWords, ...services].filter(
    (fragment) => fragment.length >= PERSONAL_FRAGMENT_MIN_LENGTH,
  );

  return email ? [email, ...fragments] : fragments;
}

function longestPredictableRun(text: string): number {
  let longest = Math.min(text.length, 1);
  let current = 1;

  for (let index = 1; index < text.length; index++) {
    const previous = text[index - 1];
    const next = text[index];
    const sameKind =
      (/\d/.test(previous) && /\d/.test(next)) ||
      (/[a-z]/.test(previous) && /[a-z]/.test(next));
    const repeated = next === previous;
    const consecutive =
      sameKind &&
      Math.abs((next.codePointAt(0) ?? 0) - (previous.codePointAt(0) ?? 0)) ===
        1;

    current = repeated || consecutive ? current + 1 : 1;
    longest = Math.max(longest, current);
  }

  return longest;
}

export function isPredictablePassword(password: string): boolean {
  const folded = fold(password);

  return (
    longestPredictableRun(folded) >=
    Math.max(PREDICTABLE_RUN_MIN_LENGTH, Math.ceil(folded.length / 2))
  );
}

export function chosenPasswordProblem(
  password: string,
  owner: PasswordOwner,
): string | null {
  const basic = passwordProblem(password);

  if (basic) return basic;

  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    return 'needs_letters_and_digits';
  }

  const folded = fold(password);

  if (personalFragments(owner).some((fragment) => folded.includes(fragment))) {
    return 'personal_data';
  }

  if (isPredictablePassword(password)) return 'predictable';

  return null;
}
