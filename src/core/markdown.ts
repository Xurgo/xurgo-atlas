interface MarkdownHeading {
  text: string;
  level: number;
  line: number;
  index: number;
}

export interface MarkdownSection {
  matchedHeading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

export interface MarkdownSectionMatch {
  heading: string;
  level: number;
  startLine: number;
  endLine: number;
  content: string;
}

export function collectMarkdownHeadings(content: string): MarkdownHeading[] {
  const lines = content.split('\n');
  const headings: MarkdownHeading[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;

  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const markerRun = fenceMatch[1];
      const marker = markerRun[0] as '`' | '~';
      if (!fence) {
        fence = { marker, length: markerRun.length };
        return;
      }

      if (marker === fence.marker && markerRun.length >= fence.length) {
        fence = null;
        return;
      }
    }

    if (fence) {
      return;
    }

    const headingMatch = line.match(/^ {0,3}(#{1,6})(?:\s+|$)(.*)$/);
    if (!headingMatch) {
      return;
    }

    headings.push({
      text: normalizeHeadingText(headingMatch[2]),
      level: headingMatch[1].length,
      line: index + 1,
      index,
    });
  });

  return headings;
}

export function extractMarkdownSections(content: string): MarkdownSectionMatch[] {
  const lines = content.split('\n');
  const headings = collectMarkdownHeadings(content);
  const sections: MarkdownSectionMatch[] = [];

  for (const heading of headings) {
    const nextHeading = headings.find(
      (candidate) =>
        candidate.index > heading.index && candidate.level <= heading.level,
    );
    const endIndex = nextHeading ? nextHeading.index : lines.length;

    sections.push({
      heading: heading.text,
      level: heading.level,
      startLine: heading.line,
      endLine: nextHeading ? nextHeading.line - 1 : countMarkdownLines(content),
      content: lines.slice(heading.index, endIndex).join('\n'),
    });
  }

  return sections;
}

export function findMarkdownSection(
  content: string,
  options: {
    heading: string;
    level?: number;
    occurrence: number;
    includeHeading: boolean;
  },
): MarkdownSection | null {
  const headings = collectMarkdownHeadings(content);
  const targetHeading = normalizeHeadingText(options.heading);
  let seen = 0;

  for (const heading of headings) {
    if (options.level !== undefined && heading.level !== options.level) {
      continue;
    }

    if (normalizeHeadingText(heading.text) !== targetHeading) {
      continue;
    }

    seen += 1;
    if (seen !== options.occurrence) {
      continue;
    }

    const nextHeading = headings.find(
      (candidate) =>
        candidate.index > heading.index && candidate.level <= heading.level,
    );
    const startIndex = options.includeHeading ? heading.index : heading.index + 1;
    const sectionContent = content.split('\n').slice(startIndex, nextHeading ? nextHeading.index : content.split('\n').length).join('\n');

    return {
      matchedHeading: heading.text,
      level: heading.level,
      startLine: heading.line,
      endLine: nextHeading ? nextHeading.line - 1 : countMarkdownLines(content),
      content: sectionContent,
    };
  }

  return null;
}

export function getMarkdownDocumentTitle(
  content: string,
  fallbackTitle: string,
): string {
  const firstHeading = collectMarkdownHeadings(content)[0];
  return firstHeading?.text?.trim().length ? firstHeading.text.trim() : fallbackTitle;
}

function normalizeHeadingText(text: string): string {
  return text
    .trim()
    .replace(/\s+#+\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function countMarkdownLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const lines = content.split('\n');
  return content.endsWith('\n') ? lines.length - 1 : lines.length;
}
