let label = '';

export function markAction(text: string): void {
  label = text.slice(0, 200);
}

export function takeAction(): string {
  const text = label;
  label = '';
  return text;
}
