import { Policy } from './policy.js';

export interface RiskAssessment {
  highRisk: boolean;
  reasons: string[];
}

/**
 * Assess risk of a proposed documentation patch.
 *
 * A patch is marked high-risk if:
 * - It deletes more than N% of the file (default 25%)
 * - It removes Markdown headings
 * - It replaces the entire file
 * - It modifies AGENTS.md
 * - It modifies .docs-policy.yml
 * - It deletes a protected file
 */
export function assessPatchRisk(
  policy: Policy,
  filePath: string,
  originalContent: string,
  newContent: string,
  patch: string,
): RiskAssessment {
  const reasons: string[] = [];
  const riskRules = policy.getRiskRules();

  // Check if modifying a protected file
  if (policy.isPathProtected(filePath)) {
    if (riskRules.protected_file_change_requires_approval) {
      reasons.push('Modifies a protected file');
    }
  }

  // Check if modifying AGENTS.md or .docs-policy.yml
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath === 'AGENTS.md' || normalizedPath === '.docs-policy.yml') {
    reasons.push(`Modifies ${normalizedPath} which requires special approval`);
  }

  // Check for entire file replacement (original is completely different from new)
  if (originalContent.length > 0 && newContent.length > 0) {
    // Calculate similarity - if it's a complete replacement
    const commonPrefixLen = commonPrefix(originalContent, newContent);
    const commonSuffixLen = commonSuffix(originalContent, newContent);

    // If the common content is very small relative to total size
    const maxLen = Math.max(originalContent.length, newContent.length);
    const commonLen = commonPrefixLen + commonSuffixLen;

    if (maxLen > 0 && commonLen / maxLen < 0.1 && riskRules.whole_file_replacement_requires_approval) {
      reasons.push('Appears to replace the entire file content');
    }
  }

  // Check for large deletion
  const deletionPercent = calculateDeletionPercent(originalContent, newContent);
  if (deletionPercent > riskRules.large_deletion_percent) {
    reasons.push(
      `Deletes ${deletionPercent.toFixed(0)}% of the file (threshold: ${riskRules.large_deletion_percent}%)`,
    );
  }

  // Check for Markdown heading removal
  if (riskRules.heading_removal_requires_approval) {
    const originalHeadings = extractMarkdownHeadings(originalContent);
    const newHeadings = extractMarkdownHeadings(newContent);
    const removedHeadings = originalHeadings.filter((h) => !newHeadings.includes(h));
    if (removedHeadings.length > 0) {
      reasons.push(`Removes Markdown heading(s): ${removedHeadings.join(', ')}`);
    }
  }

  // Check the patch for suspicious patterns
  if (patch) {
    const patchLines = patch.split('\n');
    const deleteOnlyLines = patchLines.filter(
      (l) => l.startsWith('-') && !l.startsWith('---'),
    );
    const addLines = patchLines.filter(
      (l) => l.startsWith('+') && !l.startsWith('+++'),
    );

    // If the patch only deletes content without adding
    if (deleteOnlyLines.length > 0 && addLines.length === 0) {
      reasons.push('Patch only contains deletions without any additions');
    }
  }

  return {
    highRisk: reasons.length > 0,
    reasons,
  };
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return i;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  ) {
    i++;
  }
  return i;
}

function calculateDeletionPercent(original: string, newContent: string): number {
  if (original.length === 0) return 0;
  const deleted = Math.max(0, original.length - newContent.length);
  return (deleted / original.length) * 100;
}

function extractMarkdownHeadings(content: string): string[] {
  const headings: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push(`${match[1]} ${match[2].trim()}`);
    }
  }
  return headings;
}
