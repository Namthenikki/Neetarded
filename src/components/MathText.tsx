"use client";

import 'katex/dist/katex.min.css';
import Latex from 'react-latex-next';
import { cn } from "@/lib/utils";

interface MathTextProps {
    content: string;
    className?: string;
}

export function MathText({ content, className }: MathTextProps) {
    if (!content) return null;

    // GPT-4o typically outputs inline math wrapped in \( \) and block math in \[ \]
    // react-latex-next expects $ $ for inline math and $$ $$ for block math by default
    // (We could configure react-latex-next delimiters, but a quick regex replace is very reliable here)
    const formattedContent = content
        .replace(/\\\((.*?)\\\)/g, '$$$1$$') // Replace \( \) with $ $
        .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$'); // Replace \[ \] with $$ $$ (using [\s\S] for multiline)

    return (
        <div className={cn("math-container [&_.katex]:text-[1.05em] leading-relaxed break-words whitespace-pre-wrap", className)}>
            <Latex>{formattedContent}</Latex>
        </div>
    );
}
