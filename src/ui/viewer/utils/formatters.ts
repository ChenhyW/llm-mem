
export function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleString();
}

function fmt(n: number): string {
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return String(n);
}

export function formatTokens(total?: number, input?: number, output?: number): string | null {
  const hasSplit = typeof input === 'number' && typeof output === 'number'
    && input > 0 && output > 0;

  if (hasSplit) {
    const grand = typeof total === 'number' && total > 0 ? total : input + output;
    return `🧠 input ${fmt(input)} · output ${fmt(output)} (total ${fmt(grand)})`;
  }

  const t = typeof total === 'number' ? total : undefined;
  if (t && t > 0) {
    return `🧠 ${fmt(t)} tokens`;
  }

  return null;
}
