import React from "react";

/**
 * Pre-process: convert common LaTeX commands to Unicode/plain text
 * so the React renderer can display them properly.
 */
function latexToUnicode(text: string): string {
    let result = text;

    // \frac{a}{b} → a/b
    result = result.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1/$2");

    // \sqrt{x} → √x  and  \sqrt{xy} → √(xy)
    result = result.replace(/\\sqrt\{([^}])\}/g, "√$1");
    result = result.replace(/\\sqrt\{([^}]+)\}/g, "√($1)");

    // Common Greek letters
    const greekMap: Record<string, string> = {
        "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ",
        "\\epsilon": "ε", "\\varepsilon": "ε", "\\zeta": "ζ", "\\eta": "η",
        "\\theta": "θ", "\\iota": "ι", "\\kappa": "κ", "\\lambda": "λ",
        "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\pi": "π",
        "\\rho": "ρ", "\\sigma": "σ", "\\tau": "τ", "\\phi": "φ",
        "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω",
        "\\Gamma": "Γ", "\\Delta": "Δ", "\\Theta": "Θ", "\\Lambda": "Λ",
        "\\Sigma": "Σ", "\\Phi": "Φ", "\\Psi": "Ψ", "\\Omega": "Ω",
        "\\infty": "∞", "\\pm": "±", "\\mp": "∓",
        "\\times": "×", "\\cdot": "·", "\\div": "÷",
        "\\leq": "≤", "\\geq": "≥", "\\neq": "≠", "\\approx": "≈",
        "\\rightarrow": "→", "\\leftarrow": "←", "\\Rightarrow": "⇒",
    };

    for (const [latex, unicode] of Object.entries(greekMap)) {
        // Match the LaTeX command followed by a word boundary or non-letter
        result = result.split(latex).join(unicode);
    }

    // \text{...} → just the text
    result = result.replace(/\\text\{([^}]+)\}/g, "$1");

    // \vec{x} → x̄ (using combining macron \u0304)
    result = result.replace(/\\vec\{([^}]+)\}/g, "$1\u0304");

    // \hat{x} → x̂ (using combining circumflex \u0302)
    result = result.replace(/\\hat\{([^}]+)\}/g, "$1\u0302");

    // Math functions
    const funcMap = ["cos", "sin", "tan", "sec", "csc", "cot", "log", "ln", "exp"];
    for (const func of funcMap) {
        result = result.replace(new RegExp(`\\\\${func}\\b`, "g"), func);
    }

    // Remove \left and \right (bracket sizing)
    result = result.replace(/\\left/g, "");
    result = result.replace(/\\right/g, "");

    // Subscript notation: convert _{ } and single _X
    // _0 through _9 → Unicode subscripts
    const subMap: Record<string, string> = {
        "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
        "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
        "a": "ₐ", "e": "ₑ", "i": "ᵢ", "o": "ₒ", "n": "ₙ",
        "r": "ᵣ", "x": "ₓ",
    };

    // _{single_char} where char has a Unicode subscript
    result = result.replace(/\\_\{([^}])\}/g, (_, ch) => subMap[ch] || `_${ch}`);

    // _single_char (not followed by {)
    result = result.replace(/\\_([0-9aeinorx])/g, (_, ch) => subMap[ch] || `_${ch}`);

    return result;
}

/**
 * Converts math notation in text to proper React elements:
 *   ^{1/3}  →  <sup>1/3</sup>
 *   _{0}    →  <sub>0</sub>
 *   ^2      →  <sup>2</sup>  (single char shorthand)
 *   _0      →  <sub>0</sub>  (single char shorthand)
 *
 * Also pre-processes LaTeX commands (\frac, \sqrt, Greek letters) to Unicode.
 */
export function renderMathText(text: string): React.ReactNode {
    if (!text) return text;

    // First pass: convert any LaTeX commands to Unicode
    const processed = latexToUnicode(text);

    // Second pass: convert ^{} and _{} to React sup/sub elements
    const mathPattern = /(\^{[^}]+}|_{[^}]+}|\^[0-9A-Za-z+\-*/()]|_[0-9A-Za-z+\-*/()])/g;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;

    while ((match = mathPattern.exec(processed)) !== null) {
        // Add text before the match
        if (match.index > lastIndex) {
            parts.push(processed.slice(lastIndex, match.index));
        }

        const token = match[0];
        const isSup = token.startsWith("^");
        const Tag = isSup ? "sup" : "sub";

        // Extract content: either {content} or single char
        let content: string;
        if (token.length > 2 && token[1] === "{") {
            content = token.slice(2, -1); // Remove ^{ and }
        } else {
            content = token.slice(1); // Remove ^ or _
        }

        parts.push(
            React.createElement(Tag, { key: key++, className: "text-[85%]" }, content)
        );

        lastIndex = match.index + token.length;
    }

    // Add remaining text
    if (lastIndex < processed.length) {
        parts.push(processed.slice(lastIndex));
    }

    // If no React elements were created, return the processed string
    if (parts.length === 0) return processed;
    if (parts.length === 1 && typeof parts[0] === "string") return processed;

    return React.createElement(React.Fragment, null, ...parts);
}
