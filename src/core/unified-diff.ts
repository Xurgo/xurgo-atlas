function splitPreserveLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hasTrailingNewline) {
    lines.pop();
  }
  return lines;
}

export function createUnifiedDiffForNewFile(
  filePath: string,
  newContent: string,
): string {
  const newLines = splitPreserveLines(newContent);
  let diff = `--- /dev/null\n+++ b/${filePath}\n`;
  diff += `@@ -0,0 +1,${newLines.length} @@\n`;

  for (const line of newLines) {
    diff += `+${line}\n`;
  }

  return diff;
}

export function createUnifiedDiffForReplacement(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  const oldLines = splitPreserveLines(oldContent);
  const newLines = splitPreserveLines(newContent);
  let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;
  diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

  for (const line of oldLines) {
    diff += `-${line}\n`;
  }

  for (const line of newLines) {
    diff += `+${line}\n`;
  }

  return diff;
}
