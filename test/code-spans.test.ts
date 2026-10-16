import { describe, it, expect } from "vitest";
import { splitCodeSpans } from "../src/utils/code-spans";

const codeOf = (text: string) =>
	splitCodeSpans(text)
		.filter((s) => s.code)
		.map((s) => s.text);

describe("splitCodeSpans", () => {
	it("returns plain text unchanged", () => {
		expect(splitCodeSpans("no code here")).toEqual([
			{ text: "no code here", code: false },
		]);
	});

	it("returns nothing for empty input", () => {
		expect(splitCodeSpans("")).toEqual([]);
	});

	it("splits inline code spans, backticks included", () => {
		expect(splitCodeSpans("run `bun test` now")).toEqual([
			{ text: "run ", code: false },
			{ text: "`bun test`", code: true },
			{ text: " now", code: false },
		]);
	});

	it("finds several spans", () => {
		expect(codeOf("`a` and `b`")).toEqual(["`a`", "`b`"]);
	});

	it("leaves an unclosed backtick as plain text", () => {
		expect(codeOf("typing `half")).toEqual([]);
	});

	it("pairs runs of equal length only", () => {
		expect(codeOf("``has ` inside``")).toEqual(["``has ` inside``"]);
	});

	it("skips an unmatched run and still finds later spans", () => {
		expect(codeOf("``` stray `ok`")).toEqual(["`ok`"]);
	});

	it("matches fenced blocks across lines", () => {
		expect(codeOf("see\n```ts\nconst x = 1;\n```\nend")).toEqual([
			"```ts\nconst x = 1;\n```",
		]);
	});

	it("round-trips the input", () => {
		const text = "a `b` ``c`` ` d\n```\ne\n```";
		expect(
			splitCodeSpans(text)
				.map((s) => s.text)
				.join(""),
		).toBe(text);
	});
});
