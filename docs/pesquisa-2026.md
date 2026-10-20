# Pesquisa: sensibilidade no Valorant (2026)

Levantamento feito em outubro de 2026 para embasar o Sens Finder.

## Dados de profissionais

| Fonte | Amostra / data | eDPI médio | eDPI mediano | Observações |
|---|---|---|---|---|
| ProSettings (guia de opções) | 701 pros, out/2026 | 267 | 240 | ~50% em 800 DPI, ~40% em 400 DPI; quase ninguém acima de 1600; **79% usam scoped 1,00** |
| Turbosmurfs | 699 pros, mai/2026 | 267 | 240 | mesmos números do ProSettings (mesma base) |
| ValDB | set/2026 | 247 | 224 | |
| ProSettings top-100 (citado por setup.gg) | 100 pros | 247,6 | 216,8 | |
| senslab.pro (citado em busca) | 605 pros | — | 224 | metade do meio entre 184 e 280; parte dos dados marcada como desatualizada |

**Conclusão usada no app:** mediana ~235, intervalo interquartil ~185–295, modelado como
log-normal (mediana 235, σ = 0,34). A média fica acima da mediana porque há uma cauda de pros
com sens alta.

Médias por função só apareceram numa amostra de 9 pros (BattlePooja, fev/2026: duelista 266,
iniciador 286, controlador 216). A amostra é pequena demais para ser regra. No app, a função só
ajusta ±5%.

Polling rate: não há estatística confiável. As fontes dizem que a maioria dos pros ainda usa
1000 Hz e que 4000–8000 Hz está crescendo.

## Mudanças no jogo

- **Raw Input Buffer**: removido das configurações no patch **11.06 (16/set/2025)** e agora fica
  sempre ligado no PC ("is no longer configurable … enabled at all times … more performant").
  Guias que mandam ligá-lo estão desatualizados.
- **Multiplicadores**: há **ADS** (rifles e SMGs mirando) e **scoped** (Operator, Marshal,
  Outlaw) separados, em Configurações → Geral → Mouse. Com 1,0, a sensação bate na borda da tela,
  não no centro da mira. Calculadoras da comunidade dão 0,870 (ADS) e 0,747 (scoped) para bater
  1:1 no centro. Isso é referência, não recomendação.
- **Zooms**: 1,15× (Stinger, Spectre, Ares, Odin), 1,25× (Bulldog, Phantom, Vandal),
  1,5× (Guardian, Headhunter), 2,5× (Operator 1º zoom, Tour de Force), 3,5× (Marshal, Outlaw),
  5× (Operator 2º zoom).

## Ciência da sensibilidade

- **Boudaoud, Spjut e Kim (NVIDIA, arXiv 2203.12050, 2022)**: primeiro estudo controlado sobre
  sensibilidade em tarefas de mira em primeira pessoa. Existe uma *faixa* ótima estatisticamente
  significativa por pessoa, e não um valor universal. Os pros variam até 8× dentro do mesmo jogo.
  → Justifica buscar a faixa individual em vez de copiar pros.
- **Lei de Fitts / throughput**: é a métrica padrão para comparar dispositivos e configurações
  de apontamento (Teather et al.). Não é perfeita para mira em jogo (Frontiers in Human
  Neuroscience, 2022), por isso o app combina throughput com precisão, overshoot e a opinião do
  jogador.
- **Método PSA**: comparar uma sens mais baixa e uma mais alta, escolher a mais controlável e
  estreitar o intervalo a cada rodada (~7 rodadas). É o método mais usado pela comunidade. O app
  melhora o método com **teste cego** (ordem aleatória, sem mostrar o valor) e **medição
  objetiva**.

## Fontes

- https://prosettings.net/guides/valorant-options/
- https://turbosmurfs.gg/article/valorant-settings
- https://valdb.gg/pro-settings/
- https://www.setup.gg/game/valorant/best-sens/
- https://www.setup.gg/game/valorant/raw-input-buffer/
- https://www.valorant-spind.de/en/valorant-raw-input-buffer.html
- https://battlepooja.com/average-edpi-valorant-pros/
- https://senslab.pro/pro-settings/valorant
- https://edpi-calculator.org/tools/valorant-scoped-sensitivity
- https://www.mouse-sensitivity.com/n/valorant/
- https://arxiv.org/abs/2203.12050
- https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.979293
- https://www.csit.carleton.ca/~rteather/pdfs/CHI2017_fitts_game_controllers.pdf
- https://www.3daimtrainer.com/sensitivity-finder/
