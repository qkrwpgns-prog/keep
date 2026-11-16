/** AI가 채운 내용 표시 (확인 요청) */
export function AiBadge({ text = 'AI가 채운 내용이에요, 확인해 주세요' }: { text?: string }) {
  return <div className="ai-badge" role="note">✦ {text}</div>;
}
