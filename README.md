# Champions VGC Builder

Montador de equipes competitivas de **Pokémon VGC** para o **Pokémon Champions**, o jogo oficial do circuito competitivo desde 2026. Ele analisa sua equipe enquanto você monta e sugere Pokémon, golpes, habilidades, itens e distribuição de **Stat Points (SP)** com base em:

- **dados reais**: uso no ladder (Smogon/Showdown), times e campanhas de torneios (oficiais e online), replays com vencedor, com torneios antigos e recentes ponderados por data;
- **regulação atual e patches**: legalidade, buffs e nerfs vêm direto do mod oficial do Pokémon Champions no Pokémon Showdown, atualizado a cada versão do jogo;
- **teoria de team building**: tabela de tipos (incluindo imunidades por habilidade), cores, papéis de VGC (controle de velocidade, Fake Out, redirecionamento, Intimidate, Wide Guard...), arquétipos (Tailwind, Trick Room, sol, chuva, terrenos...) e ameaças do meta.

> O golpe sugerido **não é só o mais usado**: se a sua equipe precisa de controle de velocidade, cobertura contra um tipo ou proteção contra spread, o motor recomenda o golpe que completa a equipe e explica a troca (“Troque Rock Slide por Icy Wind: sua equipe não tem controle de velocidade”).

## Recursos

- Editor de equipe (6 membros) com busca só de Pokémon legais na regulação, Mega Stones, naturezas e SP (66 no total, máx. 32 por atributo) com atributos finais calculados.
- Sugestões de Pokémon para completar a equipe, com pontuação detalhada (meta, taxa de vitória, sinergia, defesa, cobertura, papéis, ameaças, arquétipo) e pesos ajustáveis.
- Golpes “recomendados para sua equipe” × “mais usados”, itens (respeitando o Item Clause), habilidades e spreads (benchmarks de velocidade, Trick Room, bulk otimizado).
- Análise: matriz de fraquezas/resistências, cobertura ofensiva, papéis, arquétipos, tiers de velocidade, ameaças do meta e avisos de legalidade.
- Meta: uso, vitórias, top cut, tendência, cores (duplas e trios), arquétipos e times de torneios (importáveis).
- Regras e atualizações: regulação atual, calendário, histórico de patches e lista automática de mudanças do Champions em relação a Scarlet/Violet.
- Importar/exportar no formato de texto do Pokémon Showdown (EVs de SV são convertidos para SP automaticamente).
- CLI para analisar times pelo terminal.

## Como usar

Requisitos: Node.js 20+.

```bash
npm install
npm run dev          # abre o app em http://localhost:5173
```

Para gerar a versão estática (por exemplo para o GitHub Pages):

```bash
npm run build && npm run preview
```

### Atualizar o banco de dados

```bash
npm run update-data            # dex (Showdown) + meta (Smogon, Limitless, seeds)
npm run update:dex             # só regulação/legalidade/golpes/patches
npm run update:meta -- --replays=300   # meta, incluindo 300 replays recentes do Showdown
npm run update:meta -- --offline       # só os dados semente (sem internet)
```

Opções de `update:meta`: `--months=6` (meses de Smogon stats), `--since=AAAA-MM-DD` (torneios a partir de), `--half-life=60` (meia-vida em dias do peso por data), `--replays=N`. A variável `LIMITLESS_API_KEY` é opcional.

Se você tiver um clone local do Pokémon Showdown, use `SHOWDOWN_DIR=/caminho/pokemon-showdown npm run update:dex`. Atrás de proxy, rode com `NODE_USE_ENV_PROXY=1`.

**Atualização automática:** o workflow `.github/workflows/update-data.yml` roda todo dia no GitHub Actions, regenera os dados e faz commit quando algo muda (nova regulação, patch, torneio ou mês de estatísticas). O `pages.yml` publica o app no GitHub Pages.

### CLI

```bash
npm run sugerir -- meu-time.txt              # análise + sugestões
npm run sugerir -- meu-time.txt --slot=2     # itens, habilidades e spreads do 2º membro
npm run sugerir -- meu-time.txt --completar  # completa a equipe automaticamente
npm run sugerir -- --json < meu-time.txt     # saída em JSON
```

## Regras do Pokémon Champions consideradas

- Nível 50, IVs fixos, **Stat Points**: 66 no total, no máximo 32 por atributo (cada SP = +1 no atributo; equivale a 8 EVs de SV).
- Sem Terastalização; **Mega Evolução** disponível (uma por batalha).
- Item Clause, Species Clause, Open Team Sheets, leva 6 e escolhe 4.
- Lista de itens do Champions (ex.: não há Choice Band/Specs nem Assault Vest; há Choice Scarf, Life Orb, Focus Sash, Wise Glasses...).
- Mudanças de mecânica (ex.: paralisia com 1/8 de chance de travar, sono de 2–3 turnos) e de golpes (ex.: Fire Lash 90 de poder, Moonblast com 10% de efeito) aplicadas aos cálculos.

## Fontes de dados

| Fonte | Uso |
|---|---|
| [Pokémon Showdown](https://github.com/smogon/pokemon-showdown) (mod `champions`) | espécies, golpes, habilidades, itens, learnsets, legalidade por regulação e patches |
| [Smogon usage stats](https://www.smogon.com/stats/) | uso, sets, spreads e parceiros do ladder |
| [Limitless](https://play.limitlesstcg.com) | torneios online com times e campanhas (taxa de vitória) |
| Replays do Showdown | partidas com Open Team Sheets e vencedor |
| [RK9 Labs](https://rk9.gg) (team lists oficiais) | 37 eventos oficiais com times e campanhas, do Mundial 2026 aos Regionais Reg M-C de 2026 (e eventos da era SV com peso baixo) |
| Espelhos no GitHub ([MunchStats](https://github.com/PizzaTimeJoshua/munchstats)) | alternativa automática quando Smogon/Limitless estão fora do ar; fonte das team lists da RK9 |
| Seeds (`data/seed/`) | snapshot incluído no repositório (veja [`data/seed/README.md`](data/seed/README.md)); `npm run build:seeds` regenera |
| [@smogon/calc](https://github.com/smogon/damage-calc) | cálculos de dano com as regras do Champions |

Detalhes da arquitetura e das fórmulas de pontuação em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Desenvolvimento

```bash
npm run typecheck
npm test
```
