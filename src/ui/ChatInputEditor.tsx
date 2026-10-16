import * as React from "react";
const { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } =
	React;
import {
	Annotation,
	Compartment,
	EditorState,
	Prec,
	type Extension,
	type Range,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	WidgetType,
	keymap,
	placeholder as placeholderExtension,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { splitCodeSpans } from "../utils/code-spans";

/** Imperative access to the chat input, in place of a textarea element */
export interface ChatInputHandle {
	focus(): void;
	getValue(): string;
	/** Move the cursor; defaults to the end of the text */
	setCursor(pos?: number): void;
}

export interface ChatInputEditorProps {
	value: string;
	placeholder: string;
	spellcheck: boolean;
	/** Faint text shown after the input, such as a slash command's argument hint */
	hint: string | null;
	onChange: (value: string, cursor: number) => void;
	/** Runs before the editor's key bindings; preventDefault claims the key */
	onKeyDown: (event: KeyboardEvent) => void;
	/** preventDefault stops the editor from inserting the clipboard text */
	onPaste: (event: ClipboardEvent) => void;
}

/** Tags transactions that sync the `value` prop, so they skip onChange */
const externalSync = Annotation.define<boolean>();

const settingsCompartment = new Compartment();
const hintCompartment = new Compartment();

/**
 * Focus the chat input inside `root`, if one is mounted there.
 */
export function focusChatInput(root: ParentNode | null | undefined): void {
	const dom = root?.querySelector(
		".agent-client-chat-input-editor .cm-editor",
	);
	if (dom instanceof HTMLElement) {
		EditorView.findFromDOM(dom)?.focus();
	}
}

// ============================================================================
// Code span decorations
// ============================================================================

const codeMark = Decoration.mark({ class: "agent-client-code" });
const codeOpenMark = Decoration.mark({
	class: "agent-client-code agent-client-code-start agent-client-code-delim",
});
const codeCloseMark = Decoration.mark({
	class: "agent-client-code agent-client-code-end agent-client-code-delim",
});
const fenceMark = Decoration.mark({ class: "agent-client-code-delim" });
const codeBlockLine = Decoration.line({ class: "agent-client-code-block" });

/**
 * Style `inline code` as a chip and fenced blocks (a span that fills whole
 * lines) as a full-width block. Backticks stay visible but faint.
 */
function codeDecorations(state: EditorState): DecorationSet {
	const doc = state.doc;
	const ranges: Range<Decoration>[] = [];
	let from = 0;

	for (const segment of splitCodeSpans(doc.toString())) {
		const to = from + segment.text.length;
		if (segment.code) {
			const first = doc.lineAt(from);
			const last = doc.lineAt(to);
			if (
				first.from === from &&
				last.to === to &&
				first.number !== last.number
			) {
				for (let n = first.number; n <= last.number; n++) {
					ranges.push(codeBlockLine.range(doc.line(n).from));
				}
				ranges.push(
					fenceMark.range(from, first.to),
					fenceMark.range(last.from, to),
				);
			} else {
				// Content always has a non-backtick character
				const fence = segment.text.search(/[^`]/);
				ranges.push(
					codeOpenMark.range(from, from + fence),
					codeMark.range(from + fence, to - fence),
					codeCloseMark.range(to - fence, to),
				);
			}
		}
		from = to;
	}
	return Decoration.set(ranges, true);
}

// ============================================================================
// Settings and hint
// ============================================================================

function settingsExtension(
	placeholder: string,
	spellcheck: boolean,
): Extension {
	return [
		placeholderExtension(placeholder),
		EditorView.contentAttributes.of({ spellcheck: String(spellcheck) }),
	];
}

class HintWidget extends WidgetType {
	constructor(private readonly text: string) {
		super();
	}

	eq(other: HintWidget): boolean {
		return other.text === this.text;
	}

	toDOM(): HTMLElement {
		return createSpan({ cls: "agent-client-hint-text", text: this.text });
	}
}

function hintExtension(hint: string | null): Extension {
	if (!hint) return [];
	const widget = Decoration.widget({ widget: new HintWidget(hint), side: 1 });
	return EditorView.decorations.compute(["doc"], (state) =>
		Decoration.set([widget.range(state.doc.length)]),
	);
}

// ============================================================================
// Component
// ============================================================================

/**
 * CodeMirror-based chat input. Behaves as a controlled component: `value`
 * is the source of truth, and edits report back through `onChange`.
 */
export const ChatInputEditor = forwardRef<
	ChatInputHandle,
	ChatInputEditorProps
>(function ChatInputEditor(props, ref) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);

	// Editor handlers read the latest props without rebuilding the editor
	const propsRef = useRef(props);
	useLayoutEffect(() => {
		propsRef.current = props;
	});

	// Create the editor once
	useEffect(() => {
		const parent = containerRef.current;
		if (!parent) return;
		const initial = propsRef.current;

		const view = new EditorView({
			parent,
			state: EditorState.create({
				doc: initial.value,
				extensions: [
					Prec.highest(
						EditorView.domEventHandlers({
							keydown: (event) => {
								propsRef.current.onKeyDown(event);
								return event.defaultPrevented;
							},
							paste: (event) => {
								propsRef.current.onPaste(event);
								return event.defaultPrevented;
							},
							// Dropped files become attachments (InputArea handles
							// the drop); skip CodeMirror's insert-as-text
							drop: (event) =>
								(event.dataTransfer?.files.length ?? 0) > 0,
						}),
					),
					history(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					EditorView.lineWrapping,
					EditorView.decorations.compute(["doc"], codeDecorations),
					settingsCompartment.of(
						settingsExtension(
							initial.placeholder,
							initial.spellcheck,
						),
					),
					hintCompartment.of(hintExtension(initial.hint)),
					EditorView.updateListener.of((update) => {
						if (
							update.docChanged &&
							!update.transactions.some((tr) =>
								tr.annotation(externalSync),
							)
						) {
							propsRef.current.onChange(
								update.state.doc.toString(),
								update.state.selection.main.head,
							);
						}
					}),
				],
			}),
		});
		viewRef.current = view;

		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	// Sync outside changes (send, history, mentions) into the editor
	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const current = view.state.doc.toString();
		if (current === props.value) return;
		view.dispatch({
			changes: { from: 0, to: current.length, insert: props.value },
			selection: { anchor: props.value.length },
			annotations: externalSync.of(true),
		});
	}, [props.value]);

	useEffect(() => {
		viewRef.current?.dispatch({
			effects: settingsCompartment.reconfigure(
				settingsExtension(props.placeholder, props.spellcheck),
			),
		});
	}, [props.placeholder, props.spellcheck]);

	useEffect(() => {
		viewRef.current?.dispatch({
			effects: hintCompartment.reconfigure(hintExtension(props.hint)),
		});
	}, [props.hint]);

	useImperativeHandle(
		ref,
		() => ({
			focus: () => viewRef.current?.focus(),
			getValue: () => viewRef.current?.state.doc.toString() ?? "",
			setCursor: (pos) => {
				const view = viewRef.current;
				if (!view) return;
				const length = view.state.doc.length;
				view.dispatch({
					selection: { anchor: Math.min(pos ?? length, length) },
					scrollIntoView: true,
				});
			},
		}),
		[],
	);

	return (
		<div ref={containerRef} className="agent-client-chat-input-editor" />
	);
});
