/**
 * Extrai objetos literais de arquivos de dados TypeScript do Pokémon Showdown
 * (ex.: data/moves.ts) usando apenas a AST do compilador TypeScript.
 *
 * Nenhum código baixado é executado: funções (onHit, onModifyMove...) e
 * expressões não literais são ignoradas. Propriedades com valor `undefined`
 * viram o marcador DELETE, pois nos mods do Showdown elas significam
 * "remover o campo herdado".
 */
import ts from 'typescript';

export const DELETE = Symbol('delete');
/** Marca handlers (funções) presentes no objeto, para saber que há lógica customizada. */
export const HANDLER = Symbol('handler');

export type Literal =
  | string
  | number
  | boolean
  | null
  | typeof DELETE
  | typeof HANDLER
  | Literal[]
  | { [key: string]: Literal };

export type LiteralTable = Record<string, Record<string, Literal>>;

function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

function convert(node: ts.Expression): Literal | undefined {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) {
    node = node.expression;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    // Ex.: desc com `${}` — mantemos apenas o texto literal.
    return node.head.text + node.templateSpans.map(s => s.literal.text).join('');
  }
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const n = Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.MinusToken) return -n;
    if (node.operator === ts.SyntaxKind.PlusToken) return n;
    return undefined;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && node.text === 'undefined') return DELETE;
  if (ts.isVoidExpression(node)) return DELETE;
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return HANDLER;
  if (ts.isArrayLiteralExpression(node)) {
    const out: Literal[] = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) continue;
      const v = convert(el);
      if (v !== undefined && v !== DELETE) out.push(v);
    }
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: { [key: string]: Literal } = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = propName(prop.name);
        if (key === undefined) continue;
        const v = convert(prop.initializer);
        if (v !== undefined) out[key] = v;
      } else if (ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop) || ts.isSetAccessorDeclaration(prop)) {
        const key = propName(prop.name);
        if (key !== undefined) out[key] = HANDLER;
      }
      // ShorthandPropertyAssignment / SpreadAssignment referenciam código: ignorados.
    }
    return out;
  }
  return undefined;
}

/**
 * Lê `export const <Nome> ... = { ... }` e devolve as tabelas encontradas.
 */
export function extractExports(source: string, fileName = 'data.ts'): Record<string, Literal> {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: Record<string, Literal> = {};
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const exported = stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const value = convert(decl.initializer);
      if (value !== undefined && value !== null && typeof value === 'object') result[decl.name.text] = value;
    }
  }
  return result;
}

/** Lê a primeira tabela (objeto) exportada de um arquivo de dados. */
export function extractTable(source: string, fileName = 'data.ts'): LiteralTable {
  for (const value of Object.values(extractExports(source, fileName))) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as LiteralTable;
  }
  return {};
}

/** Remove marcadores internos (DELETE/HANDLER) para gerar JSON limpo. */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => clean(v)).filter(v => v !== undefined) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if ((v as unknown) === DELETE || (v as unknown) === HANDLER) continue;
      out[k] = clean(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Aplica a tabela de um mod sobre a tabela base seguindo a semântica do
 * Showdown: entradas com `inherit: true` fazem merge raso sobre a base,
 * entradas sem `inherit` substituem a base. Campos DELETE removem o herdado.
 */
export function applyMod(base: LiteralTable, mod: LiteralTable | undefined): LiteralTable {
  if (!mod) return { ...base };
  const out: LiteralTable = { ...base };
  for (const [id, entry] of Object.entries(mod)) {
    if (entry === null) {
      delete out[id];
      continue;
    }
    if (entry.inherit === true && base[id]) {
      const merged: Record<string, Literal> = { ...base[id] };
      for (const [k, v] of Object.entries(entry)) {
        if (k === 'inherit') continue;
        if (v === DELETE) delete merged[k];
        else merged[k] = v;
      }
      out[id] = merged;
    } else {
      const copy: Record<string, Literal> = {};
      for (const [k, v] of Object.entries(entry)) {
        if (k === 'inherit' || v === DELETE) continue;
        copy[k] = v;
      }
      out[id] = copy;
    }
  }
  return out;
}
