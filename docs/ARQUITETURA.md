# Arquitetura

O projeto tem três camadas independentes que conversam por arquivos JSON em `public/data/`:

```
 fontes públicas ──► scripts/ (Node, atualizador) ──► public/data/*.json ──► src/core (motor) ──► src/ui (React) / scripts/cli.ts
```

## 1. Banco de dados (`public/data/`)

| Arquivo | Gerado por | Conteúdo |
|---|---|---|
| `dex.json` | `npm run update:dex` | Espécies, golpes, habilidades, itens, naturezas e tabela de tipos **do Pokémon Champions**, extraídos do mod oficial `champions` do Pokémon Showdown (que implementa cada patch do jogo). Legalidade por regulação (Reg M-C atual, M-B anterior...), learnsets do Champions, Megas e a lista automática de mudanças Champions × Scarlet/Violet. |
| `meta.json` | `npm run update:meta` | Uso, taxa de vitória ajustada, sets (golpes, itens, habilidades, spreads de SP), parceiros, cores, arquétipos e times de torneios, agregados com decaimento temporal. |
| `heuristics.json` | curado (pesquisa) | Papéis de VGC (controle de velocidade, Fake Out, redirecionamento...), arquétipos, sinergias e princípios de spreads usados pelo motor. |
| `patches.json` | curado (pesquisa) + automático | Histórico de versões/patches do Champions com buffs e nerfs. |
| `regulations.json` | curado (pesquisa) | Regras da regulação atual, calendário de torneios e itens disponíveis. |

### Por que o Showdown?
O Pokémon Showdown mantém um mod `data/mods/champions` que é atualizado a cada patch do Champions (ex.: “Implement 1.1.0 changes”, “Add Champions Regulation M-C”). O atualizador **não executa** código baixado: ele lê os arquivos `.ts` com o parser do TypeScript e extrai só os literais (`scripts/lib/tsLiteral.ts`), aplicando a semântica de herança (`inherit: true`) dos mods.

A regulação atual é detectada automaticamente em `config/formats.ts` (formato `[Gen 9 Champions] VGC <ano> Reg X-Y` visível no ladder). Quando sair uma nova regulação, basta rodar o atualizador.

## 2. Meta (`scripts/update-meta.ts`)

Fontes (cada uma opcional; falhas são registradas e ignoradas):

1. **Seeds** (`data/seed/*.json.gz`, gerados por `npm run build:seeds`): snapshot de uso do ladder e de times com resultado (37 eventos oficiais da RK9 + torneios online do Limitless).
2. **Smogon usage stats** (`smogon.com/stats/<mês>/chaos/<formato>-<corte>.json`): uso, golpes, itens, habilidades, spreads e parceiros do ladder do Showdown, por mês. Se o site não responder, usa o espelho dividido do MunchStats no GitHub.
3. **Team lists oficiais (RK9)** via espelho MunchStats (`stats/tournaments/tournaments_index.json`): Regionais, Internacionais e Mundial com time completo, colocação e campanha de cada jogador. Eventos da era Scarlet/Violet entram só com o Dia 2 e com peso baixo.
4. **Limitless** (`play.limitlesstcg.com/api`): torneios online com lista de times e campanha (vitórias/derrotas) → taxa de vitória real por Pokémon, dupla e set; o espelho do MunchStats (janela de 30 dias) completa o que a API não trouxer.
5. **Replays do Showdown** (opcional, `--replays`): partidas de alto rating → time de cada jogador (Open Team Sheets) + vencedor.

Quando uma fonte ao vivo traz o mesmo mês/formato ou o mesmo evento que um seed, o seed é descartado (sem contagem dupla).

Ponderação de cada amostra:

- **Decaimento temporal**: `peso = 0,5 ^ (idade_em_dias / meia_vida)` (meia-vida padrão 60 dias) — torneios antigos contam, mas menos.
- **Regulação**: atual = 1,0; anterior do Champions = 0,35; mais antigas = 0,15; era Scarlet/Violet = 0,05.
- **Patches**: amostras anteriores a um patch que alterou a espécie, um golpe ou habilidade dela recebem peso × 0,5.
- **Tipo de fonte**: torneio oficial > torneio online > ladder alto > ladder geral.

Taxa de vitória usa encolhimento bayesiano: `(V + k·0,5) / (J + k)` com `k = 20`, evitando que poucas partidas gerem números extremos.

## 3. Motor (`src/core/`)

- `dex.ts`, `typechart.ts`, `stats.ts`, `paste.ts`: acesso aos dados, tabela de tipos com habilidades (Levitate, Storm Drain...), fórmula de atributos do Champions (66 SP, máx. 32 por atributo) e import/export no formato do Showdown.
- `roles.ts`: detecta papéis (controle de velocidade, Fake Out, Intimidate, redirecionamento, Wide Guard, setters de clima/terreno, Trick Room...).
- `analysis.ts`: fraquezas/resistências da equipe, cobertura ofensiva, papéis faltando, arquétipo, tiers de velocidade, ameaças do meta e problemas (Item Clause, SP inválido...).
- `team.ts`: resolve cada membro na forma de batalha (Mega), atributos, tipos de ataque, ameaças do meta e set provável de cada ameaça.
- `suggest/pokemon.ts`: ranking de candidatos (`rankPokemon`) e sugestões com set completo (`suggestPokemon`).
- `suggest/moves.ts`: golpes no contexto da equipe, escolha gulosa dos 4, comparação com os mais usados e explicação de cada troca.
- `suggest/items.ts`, `abilities.ts`, `spreads.ts`: itens (Item Clause, Megas), habilidades e spreads de SP (meta, benchmarks de velocidade, Trick Room, Tailwind, bulk).
- `suggest/build.ts` e `autocomplete.ts`: set completo para uma espécie na equipe e preenchimento automático até 6 membros, preservando as escolhas do usuário.
- `damage.ts`: cálculos com `@smogon/calc` (geração 0 = Champions) e confrontos rápidos contra as ameaças do meta.
- `weights.ts`: pesos padrão dos componentes; `engine.ts`: implementa a interface `EngineApi` de `api.ts`.

### Pontuação de sugestões de Pokémon
`score = Σ peso_i × componente_i`, componentes normalizados 0–1:

| Componente | Ideia |
|---|---|
| meta | percentil de uso ponderado |
| winRate | taxa de vitória ajustada (só pesa com amostra suficiente) |
| synergy | *lift* de parceria com os membros atuais (dados de times reais) e taxa de vitória das duplas |
| defensive | quanto melhora as fraquezas compartilhadas da equipe |
| offensive | tipos que a equipe ainda não acerta super efetivo |
| roles | papéis que faltam e que ele cumpre |
| threats | ameaças do meta que ele responde |
| archetype | encaixe no modo de jogo detectado (Trick Room, Tailwind, sol, chuva...) |

### Sugestão de golpes
Parte do uso no meta, mas ajusta pelo contexto: preencher papel que falta na equipe (ex.: Icy Wind se não há controle de velocidade), cobertura contra tipos/ameaças descobertos, conflitos (Tailwind em time de Trick Room), dano em aliado (Earthquake sem parceiro imune), redundância e categoria (físico × especial). O resultado mostra lado a lado **“recomendado para sua equipe”** e **“mais usado”**, explicando cada diferença.

## 4. Interface (`src/ui/`)
React + Vite, em português. Abas: montar equipe, análise, meta, atualizações/regras e fontes de dados. A equipe fica salva no navegador e pode ser importada/exportada no formato do Showdown.

## 5. Atualização automática
`.github/workflows/update-data.yml` roda o atualizador diariamente no GitHub Actions e faz commit dos JSON quando algo muda. Localmente: `npm run update-data`.
