/** Junta classes condicionais. ponytail: sem clsx/tailwind-merge — não há conflito de classes a resolver aqui. */
export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
