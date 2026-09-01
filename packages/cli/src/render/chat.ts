export function renderChatFlushResult(result: any) {
  return result?.dryRun
    ? [
        `[dry-run] would delete the entire chat log: ${result?.count ?? 0} message(s)`,
        `remaining after the flush: 0`
      ].join("\n")
    : [
        `Flushed the chat log: deleted ${result?.deleted ?? 0} of ${result?.count ?? 0} message(s)`,
        `remaining: ${result?.remaining ?? 0}`
      ].join("\n");
}

export function renderChatDetails(message: any) {
  const lines = [
    `id: ${message?.id}`,
    `author: ${message?.author ?? ""}`,
    `alias: ${message?.speaker?.alias ?? ""}`,
    `whisper: ${Array.isArray(message?.whisper) ? message.whisper.join(", ") : ""}`,
    `blind: ${String(Boolean(message?.blind))}`,
    `style: ${message?.style ?? ""}`,
    `flavor: ${message?.flavor ?? ""}`,
    `timestamp: ${message?.timestamp ?? ""}`,
    `content: ${message?.content ?? ""}`
  ];
  if (Array.isArray(message?.rolls) && message.rolls.length > 0) {
    const roll = message.rolls[0] ?? {};
    lines.push(`roll total: ${roll?.total ?? ""}`);
    lines.push(`roll formula: ${roll?.formula ?? ""}`);
  }
  return lines.join("\n");
}
