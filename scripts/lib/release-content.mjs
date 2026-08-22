export function canonicalReleaseContent(content) {
  const decoded = content.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(content)) return content;
  return Buffer.from(decoded.replaceAll('\r\n', '\n'), 'utf8');
}
