/**
 * CLI de análise e sugestões.
 *
 *   npm run sugerir -- time.txt            # analisa um paste do Showdown
 *   npm run sugerir -- time.txt --slot=2   # detalha sugestões do 2º membro
 *   cat time.txt | npm run sugerir         # lê da entrada padrão
 *   npm run sugerir -- --top=15 --json     # saída em JSON
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeTeam, autoComplete, createEngineContext, suggestAbilities, suggestItems, suggestMoves, suggestPokemon, suggestSpreads,
} from '../src/core/engine.ts';
import type { Heuristics } from '../src/core/api.ts';
import { exportTeam, parseTeam } from '../src/core/paste.ts';
import { TYPE_PT, pct } from '../src/core/i18n.ts';
import type { Dex, Meta } from '../src/core/types.ts';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const opt = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const has = (name: string) => args.includes(`--${name}`);
const file = args.find(a => !a.startsWith('--'));

function load<T>(name: string): T {
  const path = join(ROOT, 'public', 'data', name);
  if (!existsSync(path)) throw new Error(`${path} não encontrado — rode npm run update-data`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function readInput(): Promise<string> {
  if (file) return readFileSync(file, 'utf8');
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function line(text = '') {
  console.log(text);
}

async function main() {
  const dex = load<Dex>('dex.json');
  const meta = load<Meta>('meta.json');
  const heuristics = load<Heuristics>('heuristics.json');
  const ctx = createEngineContext(dex, meta, heuristics, undefined, opt('reg'));
  const team = parseTeam(await readInput());
  const top = Number(opt('top') ?? 8);

  const analysis = analyzeTeam(ctx, team);
  const suggestions = suggestPokemon(ctx, team, top);
  const moveSets = team.map((_, i) => suggestMoves(ctx, team, i));
  const slot = opt('slot') ? Number(opt('slot')) - 1 : null;

  if (has('json')) {
    const detail = slot !== null && team[slot]
      ? { items: suggestItems(ctx, team, slot), abilities: suggestAbilities(ctx, team, slot), spreads: suggestSpreads(ctx, team, slot) }
      : undefined;
    console.log(JSON.stringify({ analysis, suggestions, moveSets, detail }, null, 2));
    return;
  }

  line(`Champions VGC Builder — Reg ${ctx.dex.regulation} · dados de ${meta.generatedAt.slice(0, 10)}`);
  line(`Equipe: ${team.length ? team.map(s => s.species).join(', ') : '(vazia)'}`);
  line(`Nota geral: ${analysis.score}/100`);
  for (const s of analysis.summaryPt) line(`  • ${s}`);

  const bad = analysis.defensive.filter(r => r.status !== 'ok');
  if (bad.length) {
    line('\nFraquezas compartilhadas:');
    for (const r of bad) line(`  ${r.status === 'bad' ? '✖' : '!'} ${TYPE_PT[r.type]}: ${r.weak} fracos, ${r.resist} resistem, ${r.immune} imunes`);
  }
  if (analysis.missingRoles.length) line(`\nPapéis faltando: ${analysis.missingRoles.map(r => r.namePt).join(', ')}`);
  if (analysis.archetypes.length) line(`Arquétipo detectado: ${analysis.archetypes.map(a => `${a.def.namePt} (${pct(a.confidence, 0)})`).join(', ')}`);
  if (analysis.threats.length) {
    line('\nAmeaças do meta:');
    for (const t of analysis.threats.slice(0, 6)) line(`  - ${t.species} (uso ${pct(t.usage)}): ${t.reasonPt}`);
  }
  if (analysis.issues.length) {
    line('\nAvisos:');
    for (const i of analysis.issues) line(`  [${i.severity}] ${i.messagePt}`);
  }

  line('\nSugestões de Pokémon:');
  for (const [i, s] of suggestions.entries()) {
    line(`  ${i + 1}. ${s.species} — ${s.score.toFixed(1)} pts`);
    for (const r of s.reasonsPt) line(`       · ${r}`);
  }

  if (team.length) {
    line('\nGolpes recomendados para a sua equipe:');
    team.forEach((set, i) => {
      const m = moveSets[i];
      line(`  ${set.species}: ${m.recommended.join(' / ')}`);
      if (m.mostUsed.length && m.mostUsed.join() !== m.recommended.join()) line(`    mais usado: ${m.mostUsed.join(' / ')}`);
      for (const d of m.diffPt) line(`    → ${d}`);
    });
  }

  if (slot !== null && team[slot]) {
    line(`\nDetalhes de ${team[slot].species}:`);
    line('  Itens: ' + suggestItems(ctx, team, slot).slice(0, 5).map(s => `${s.item}${s.blocked ? ' (já usado)' : ''}`).join(', '));
    line('  Habilidades: ' + suggestAbilities(ctx, team, slot).map(s => s.ability).join(', '));
    for (const s of suggestSpreads(ctx, team, slot).slice(0, 5)) {
      line(`  Spread "${s.labelPt}": ${s.nature} ${Object.entries(s.sp).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(' / ')}`);
      for (const r of s.reasonsPt) line(`     · ${r}`);
    }
  }

  if (has('completar')) {
    line('\nEquipe completada automaticamente:\n');
    line(exportTeam(autoComplete(ctx, team)));
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
