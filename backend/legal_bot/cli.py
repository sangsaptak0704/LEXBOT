"""Interactive command-line interface for the legal chatbot."""

from __future__ import annotations

import argparse
import sys
import textwrap

from .chatbot import BOT_NAME, LegalChatbot

BANNER = f"""\
==============================================================================
  {BOT_NAME} - Smart Legal Advice Chatbot
  Semantic net + rule-based reasoning  |  type 'help' for examples
=============================================================================="""


def _print_bot(text: str) -> None:
    print(f"\n{BOT_NAME}:")
    print(textwrap.indent(text, "  "))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="legal-chatbot",
        description="Interactive legal FAQ chatbot using a semantic net and rule-based reasoning.")
    parser.add_argument("-q", "--question", help="ask a single question and exit")
    parser.add_argument("--trace", action="store_true",
                        help="print the reasoning trace after every answer")
    parser.add_argument("--export-graph", metavar="FILE",
                        help="write the semantic net as a Graphviz .dot file and exit")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    bot = LegalChatbot()

    if args.export_graph:
        with open(args.export_graph, "w", encoding="utf-8") as fh:
            fh.write(bot.net.to_dot())
        print(f"Semantic net ({len(bot.net)} concepts, {len(bot.net.edges())} relations) "
              f"written to {args.export_graph}")
        return 0

    if args.question:
        _print_bot(bot.respond(args.question))
        if args.trace:
            _print_bot(bot.explain())
        return 0

    print(BANNER)
    _print_bot(bot.greeting())
    while not bot.finished:
        try:
            question = input("\nYou: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            _print_bot("Goodbye!")
            break
        if not question:
            continue
        before = bot.last_turn
        _print_bot(bot.respond(question))
        if args.trace and bot.last_turn is not before:
            _print_bot(bot.explain())
    return 0


if __name__ == "__main__":
    sys.exit(main())
