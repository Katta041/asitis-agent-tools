// JSON parsing that keeps line and column for every value, for agent config files (F9).
// Owner: WP6.
//
// Why not JSON.parse: it gives no line numbers, and a finding has to point at the line that holds
// the hook or the server. This parser is one forward pass with an explicit stack (no recursion),
// so a 64 KB nesting bomb cannot overflow the call stack and the work stays linear in the input.
// Locations live in a tree next to the value instead of a map of pointer strings, because pointer
// strings grow with depth times key length and that is quadratic on hostile input.
//
// Semantics follow JSON.parse (RFC 8259): a repeated key keeps the last value, "__proto__" is a
// plain key. Two relaxations are opt-in through { jsonc: true } for files their tool reads as
// JSON with comments (VS Code's mcp.json): // and /* */ comments and trailing commas. A leading
// byte order mark is skipped in both modes.

export interface JsonLocation {
  /** 1-based line and UTF-16 column of the first character of the value. */
  line: number;
  column: number;
  /** End of the value, exclusive, same units. */
  endLine: number;
  endColumn: number;
  /** For an object member: where its key starts. */
  keyLine?: number;
  keyColumn?: number;
}

/**
 * A value's place in the text, mirroring the parsed value. Offsets only (UTF-16 code units, end
 * exclusive); locate() turns them into lines and columns on demand, so a file with millions of
 * values does not pay for a line lookup per value.
 */
export interface JsonNode {
  start: number;
  end: number;
  /** For an object member: where its key starts. */
  keyStart?: number;
  /** Object members by key (last one wins, as in JSON.parse) or array elements by index. */
  children?: Map<string, JsonNode> | JsonNode[];
}

export type JsonMapResult =
  | { ok: true; value: unknown; root: JsonNode; at(pointer: string): JsonLocation | undefined; locate(node: JsonNode): JsonLocation }
  | { ok: false; message: string; line: number; column: number };

export interface JsonMapOptions {
  /** Allow // and /* *\/ comments and trailing commas (JSON with comments, as VS Code reads it). */
  jsonc?: boolean;
}

type Frame =
  | { type: "object"; value: Record<string, unknown>; node: JsonNode; children: Map<string, JsonNode>; key: string | null; keyStart: number; light: boolean }
  | { type: "array"; value: unknown[]; node: JsonNode; children: JsonNode[]; light: boolean };

/**
 * Below this depth the parser still checks the syntax but keeps no values or locations: no agent
 * config nests this deep, and building millions of empty containers is what makes a nesting bomb
 * slow. The value at the cut-off depth reads as null.
 */
const MAX_KEPT_DEPTH = 128;
const LIGHT_NODE: JsonNode = { start: 0, end: 0 };
const LIGHT_OBJ = Object.create(null) as Record<string, unknown>;
const LIGHT_ARR: unknown[] = [];
const LIGHT_MAP = new Map<string, JsonNode>();
const LIGHT_LIST: JsonNode[] = [];
// Shared by every frame past MAX_KEPT_DEPTH; their key is reset after each member and never read.
const LIGHT_OBJECT_FRAME: Frame = { type: "object", value: LIGHT_OBJ, node: LIGHT_NODE, children: LIGHT_MAP, key: null, keyStart: 0, light: true };
const LIGHT_ARRAY_FRAME: Frame = { type: "array", value: LIGHT_ARR, node: LIGHT_NODE, children: LIGHT_LIST, light: true };

class JsonError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/** Short, plain description of the character at offset, for error messages. */
function describe(text: string, i: number): string {
  if (i >= text.length) return "the end of the file";
  const c = text[i]!;
  if (c === "\n" || c === "\r") return "a line break";
  if (c === "'") return "a single quote (JSON strings need double quotes)";
  const code = c.charCodeAt(0);
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return `the control character U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  if (/[A-Za-z_$]/.test(c)) {
    let j = i;
    while (j < text.length && j - i < 20 && /[A-Za-z0-9_$]/.test(text[j]!)) j++;
    return `"${text.slice(i, j)}"`;
  }
  return `"${c}"`;
}

/**
 * Parses text and keeps the location of every value. Never throws: a syntax error comes back as
 * { ok: false } with a plain message and the 1-based line and column where parsing stopped.
 */
export function parseJsonMap(text: string, opts: JsonMapOptions = {}): JsonMapResult {
  const jsonc = !!opts.jsonc;
  // Line starts, for offset -> line/column. Built once, binary-searched.
  const lineStarts: number[] = [0];
  for (let k = text.indexOf("\n"); k !== -1; k = text.indexOf("\n", k + 1)) lineStarts.push(k + 1);
  const lc = (off: number): { line: number; column: number } => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= off) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: off - lineStarts[lo]! + 1 };
  };

  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;

  const skipWs = (): void => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) {
        i++;
        continue;
      }
      if (c === 0x2f /* / */ && i + 1 < n) {
        const d = text.charCodeAt(i + 1);
        if (d === 0x2f || d === 0x2a) {
          if (!jsonc) throw new JsonError("comments are not allowed in this file (it is strict JSON); remove the comment", i);
          if (d === 0x2f) {
            const e = text.indexOf("\n", i + 2);
            i = e === -1 ? n : e + 1;
          } else {
            const e = text.indexOf("*/", i + 2);
            if (e === -1) throw new JsonError("a /* comment is never closed", i);
            i = e + 2;
          }
          continue;
        }
      }
      break;
    }
  };

  const parseString = (): string => {
    // text[i] is the opening quote.
    const start = i;
    i++;
    let out = "";
    let chunk = i;
    while (true) {
      if (i >= n) throw new JsonError("a string is never closed (missing \")", start);
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (c < 0x20) throw new JsonError(c === 0x0a || c === 0x0d ? "a string runs past the end of the line (missing \")" : `a string contains ${describe(text, i)}; escape it`, i);
      if (c === 0x5c) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        switch (e) {
          case '"': out += '"'; break;
          case "\\": out += "\\"; break;
          case "/": out += "/"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "n": out += "\n"; break;
          case "r": out += "\r"; break;
          case "t": out += "\t"; break;
          case "u": {
            const hex = text.slice(i + 2, i + 6);
            if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new JsonError("a \\u escape needs four hex digits", i);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            throw new JsonError(`${e === undefined ? "a backslash at the end of the file" : `the escape \\${e}`} is not valid in JSON`, i);
        }
        i += 2;
        chunk = i;
        continue;
      }
      i++;
    }
  };

  const digits = (): number => {
    const from = i;
    while (i < n) {
      const d = text.charCodeAt(i);
      if (d < 0x30 || d > 0x39) break;
      i++;
    }
    return i - from;
  };
  // JSON number grammar (RFC 8259 section 6), scanned by hand: -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?
  const parseNumber = (): number => {
    const start = i;
    if (text.charCodeAt(i) === 0x2d) i++;
    const first = text.charCodeAt(i);
    if (first === 0x30) i++;
    else if (first >= 0x31 && first <= 0x39) digits();
    else throw new JsonError(`expected a value but found ${describe(text, start)}`, start);
    if (text.charCodeAt(i) === 0x2e) {
      i++;
      if (!digits()) throw new JsonError(`a number needs digits after the decimal point`, i);
    }
    const e = text.charCodeAt(i);
    if (e === 0x65 || e === 0x45) {
      i++;
      const sign = text.charCodeAt(i);
      if (sign === 0x2b || sign === 0x2d) i++;
      if (!digits()) throw new JsonError(`a number needs digits after the exponent`, i);
    }
    if (i < n && /[0-9A-Za-z.]/.test(text[i]!)) throw new JsonError(`a number is followed by ${describe(text, i)}`, i);
    return Number(text.slice(start, i));
  };

  const mkNode = (start: number): JsonNode => ({ start, end: start });
  const close = (node: JsonNode, end: number): void => {
    node.end = end;
  };

  const stack: Frame[] = [];
  let rootValue: unknown;
  let rootNode: JsonNode | undefined;

  /** Attaches a finished value to its parent, or makes it the root. */
  const attach = (value: unknown, node: JsonNode): void => {
    const top = stack[stack.length - 1];
    if (!top) {
      rootValue = value;
      rootNode = node;
      return;
    }
    if (top.light) {
      if (top.type === "object") top.key = null;
      return;
    }
    if (top.type === "array") {
      top.value.push(value);
      top.children.push(node);
    } else {
      const key = top.key!;
      node.keyStart = top.keyStart;
      top.value[key] = value;
      top.children.delete(key); // so a repeated key moves to the end, like JSON.parse's order
      top.children.set(key, node);
      top.key = null;
    }
  };

  /** Closes a container frame at the current offset and hands it to its parent. */
  const finish = (f: Frame): void => {
    if (f.light) {
      attach(null, mkNode(i));
      return;
    }
    close(f.node, i);
    attach(f.value, f.node);
  };

  try {
    skipWs();
    if (i >= n) throw new JsonError("the file is empty; it needs at least {}", i);
    // Expecting a value at the top of each iteration unless a container just closed.
    let expectValue = true;
    while (true) {
      if (expectValue) {
        skipWs();
        const start = i;
        const c = text[i];
        if (c === "{") {
          i++;
          if (stack.length >= MAX_KEPT_DEPTH) {
            stack.push(LIGHT_OBJECT_FRAME);
          } else {
            const node = mkNode(start);
            const value = Object.create(null) as Record<string, unknown>;
            const children = new Map<string, JsonNode>();
            node.children = children;
            stack.push({ type: "object", value, node, children, key: null, keyStart: 0, light: false });
          }
          // Read the first key or the closing brace.
          skipWs();
          if (text[i] === "}") {
            i++;
            const f = stack.pop()!;
            finish(f);
            expectValue = false;
          } else {
            readKey();
          }
          if (expectValue) continue;
        } else if (c === "[") {
          i++;
          if (stack.length >= MAX_KEPT_DEPTH) {
            stack.push(LIGHT_ARRAY_FRAME);
          } else {
            const node = mkNode(start);
            const value: unknown[] = [];
            const children: JsonNode[] = [];
            node.children = children;
            stack.push({ type: "array", value, node, children, light: false });
          }
          skipWs();
          if (text[i] === "]") {
            i++;
            const f = stack.pop()!;
            finish(f);
            expectValue = false;
          }
          if (expectValue) continue;
        } else {
          let value: unknown;
          if (c === '"') value = parseString();
          else if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) value = parseNumber();
          else if (text.startsWith("true", i)) {
            value = true;
            i += 4;
          } else if (text.startsWith("false", i)) {
            value = false;
            i += 5;
          } else if (text.startsWith("null", i)) {
            value = null;
            i += 4;
          } else {
            const top = stack[stack.length - 1];
            if (c === "]" || c === "}") {
              throw new JsonError(jsonc ? `expected a value but found "${c}"` : `a trailing comma before "${c}" is not allowed in strict JSON; remove the comma`, i);
            }
            throw new JsonError(`expected a value${top ? "" : " (the file should start with {)"} but found ${describe(text, i)}`, i);
          }
          const top = stack[stack.length - 1];
          if (top?.light) {
            if (top.type === "object") top.key = null;
          } else {
            const node = mkNode(start);
            close(node, i);
            attach(value, node);
          }
          expectValue = false;
        }
      }
      // After a value: a comma, a closing bracket, or the end.
      skipWs();
      const top = stack[stack.length - 1];
      if (!top) {
        if (i < n) throw new JsonError(`unexpected ${describe(text, i)} after the end of the JSON value`, i);
        break;
      }
      const c = text[i];
      if (c === ",") {
        i++;
        skipWs();
        if (top.type === "object") {
          if (jsonc && text[i] === "}") continue; // trailing comma, handled below
          readKey();
        } else {
          if (jsonc && text[i] === "]") continue;
        }
        expectValue = true;
        continue;
      }
      if ((c === "}" && top.type === "object") || (c === "]" && top.type === "array")) {
        i++;
        stack.pop();
        finish(top);
        expectValue = false;
        continue;
      }
      if (c === undefined) throw new JsonError(`the file ends before the ${top.type === "object" ? "object is closed (missing })" : "array is closed (missing ])"}`, i);
      throw new JsonError(`expected a comma or ${top.type === "object" ? "}" : "]"} but found ${describe(text, i)}`, i);
    }
  } catch (e) {
    if (e instanceof JsonError) {
      const p = lc(Math.min(e.offset, n));
      return { ok: false, message: e.message, line: p.line, column: p.column };
    }
    throw e;
  }

  const root = rootNode!;
  const locate = (node: JsonNode): JsonLocation => {
    const s = lc(node.start);
    const e = lc(node.end);
    const loc: JsonLocation = { line: s.line, column: s.column, endLine: e.line, endColumn: e.column };
    if (node.keyStart !== undefined) {
      const k = lc(node.keyStart);
      loc.keyLine = k.line;
      loc.keyColumn = k.column;
    }
    return loc;
  };
  return {
    ok: true,
    value: rootValue,
    root,
    locate,
    at: (pointer: string) => {
      const node = nodeAt(root, pointer);
      return node ? locate(node) : undefined;
    },
  };

  /** Reads `"key" :` inside the current object; the value follows. */
  function readKey(): void {
    const top = stack[stack.length - 1]!;
    if (top.type !== "object") return;
    skipWs();
    if (text[i] !== '"') {
      if (text[i] === "}") throw new JsonError('a trailing comma before "}" is not allowed in strict JSON; remove the comma', i);
      throw new JsonError(`expected a key in double quotes but found ${describe(text, i)}`, i);
    }
    top.keyStart = i;
    top.key = parseString();
    skipWs();
    if (text[i] !== ":") throw new JsonError(`expected ":" after the key but found ${describe(text, i)}`, i);
    i++;
  }
}

/** The node at a JSON Pointer (RFC 6901: "/hooks/PreToolUse/0"), or undefined. "" is the root. */
export function nodeAt(root: JsonNode, pointer: string): JsonNode | undefined {
  if (pointer === "") return root;
  if (!pointer.startsWith("/")) return undefined;
  let node: JsonNode | undefined = root;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    const ch: JsonNode["children"] = node?.children;
    if (!ch) return undefined;
    node = Array.isArray(ch) ? (/^(0|[1-9][0-9]*)$/.test(key) ? ch[Number(key)] : undefined) : ch.get(key);
    if (!node) return undefined;
  }
  return node;
}

/** Escapes one key for a JSON Pointer. */
export const pointerKey = (k: string): string => k.replace(/~/g, "~0").replace(/\//g, "~1");
