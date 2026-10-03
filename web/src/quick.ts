/** “9:30 开会”“下午3点 取快递”“20:00 跑步”：开头的时间自动识别。 */
export function parseQuick(input: string): { title: string; time: string } {
  const text = input.trim();
  const match = /^(上午|早上|中午|下午|晚上)?\s*(\d{1,2})(点半|[:：点时](\d{1,2})?分?)\s*(.*)$/.exec(text);
  if (!match || !match[5]) return { title: text, time: '' };
  let hour = Number(match[2]);
  const minute = match[3] === '点半' ? 30 : Number(match[4] || 0);
  if ((match[1] === '下午' || match[1] === '晚上') && hour < 12) hour += 12;
  if (match[1] === '中午' && hour < 11) hour += 12;
  if (hour > 23 || minute > 59) return { title: text, time: '' };
  return { title: match[5].trim(), time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}
