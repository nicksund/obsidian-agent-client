export interface TextSegment {
	text: string;
	/** True when the segment is a code span, backticks included */
	code: boolean;
}

/**
 * Split text into plain and code-span segments, following CommonMark:
 * a run of N backticks opens a span that the next run of exactly N closes.
 * A run with no matching close stays plain text. Fenced blocks match too,
 * since a ``` run pairs with the closing ``` run.
 *
 * Joining every segment's text gives back the input unchanged.
 */
export function splitCodeSpans(text: string): TextSegment[] {
	const segments: TextSegment[] = [];
	const runs = /`+/g;
	let plainStart = 0;
	let open: RegExpExecArray | null;

	while ((open = runs.exec(text)) !== null) {
		const afterOpen = runs.lastIndex;
		let close: RegExpExecArray | null;
		do {
			close = runs.exec(text);
		} while (close !== null && close[0].length !== open[0].length);

		if (close === null) {
			// Unmatched run is literal; resume scanning right after it
			runs.lastIndex = afterOpen;
			continue;
		}

		if (open.index > plainStart) {
			segments.push({
				text: text.slice(plainStart, open.index),
				code: false,
			});
		}
		plainStart = runs.lastIndex;
		segments.push({ text: text.slice(open.index, plainStart), code: true });
	}

	if (plainStart < text.length) {
		segments.push({ text: text.slice(plainStart), code: false });
	}
	return segments;
}
