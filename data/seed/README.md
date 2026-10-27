# Dados semente

Snapshot incluído no repositório para o app funcionar offline e antes da primeira atualização automática. O `npm run update:meta` combina estes dados com as fontes ao vivo; quando uma fonte ao vivo traz o mesmo mês de estatísticas ou o mesmo torneio, ela substitui o seed.

| Arquivo | Conteúdo | Origem |
|---|---|---|
| `meta_seed.json.gz` | Uso do ladder do Pokémon Showdown (Smogon usage stats, corte 1760) de Reg M-C e Reg M-B, Bo1 e Bo3, com golpes, itens, habilidades, spreads de SP e parceiros; arquétipos do Reg M-C com descrição em português. | [Smogon](https://www.smogon.com/stats/), via espelho [MunchStats](https://github.com/PizzaTimeJoshua/munchstats) |
| `tournaments_seed.json.gz` | Times com resultado: 37 eventos oficiais com team lists e campanhas (Regionais, Internacionais e o Mundial; da temporada 2026 em Scarlet/Violet até os Regionais Reg M-C de outubro de 2026) e torneios online do Limitless (Reg M-C, últimos 30 dias, ≥ 32 jogadores). | [RK9 Labs](https://rk9.gg) e "Data from [Limitless TCG](https://play.limitlesstcg.com)", via espelho MunchStats |

Regenerar: `npm run build:seeds` (opções `--since=AAAA-MM-DD`, `--months=N`).

Os dados pertencem às suas fontes originais; o projeto só agrega estatísticas públicas para fins de estudo de team building.
