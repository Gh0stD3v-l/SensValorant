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

## Precisão do finder (pesquisa de out/2026)

- **NVIDIA, Boudaoud, Spjut e Kim (IEEE CoG 2022; IEEE Transactions on Games 15(4), 2023)**: na
  média, as pessoas miraram melhor entre **0,45 e 1,8 °/mm, ou seja, 20–80 cm/360**. Muitos escolheram
  ~30 cm/360, geralmente dentro da própria faixa ótima. O ótimo vem de um **trade-off entre
  velocidade e precisão** que depende da dificuldade do alvo, e o estudo analisa os sub-movimentos.
  → O app estima a **curva desempenho × sens** de cada jogador, mostra a **faixa ótima** e avisa
  quando o resultado sai de 20–80 cm/360.
- **Sub-movimentos na mira** (Experimental Brain Research 2024; Roberts et al. 2020): o movimento
  primário cobre a maior parte da distância e as correções vêm depois. Há um viés natural de parar
  um pouco antes do alvo, porque passar do alvo custa mais para corrigir. Movimentos mais rápidos
  ficam menos precisos. → O app calcula o **equilíbrio do 1º movimento** (a sens em que o erro
  médio do flick fica em −3%) e conta as correções.
- **KovaaK's como plataforma de métricas (Frontiers in Sports and Active Living, 2024)**: as métricas
  de mira são muito confiáveis (ICC 0,947–0,995), mas existe **efeito de aprendizado** entre as
  tentativas em algumas tarefas. → O app desconta a ordem (aprendizado/cansaço) na curva, usa ordem
  A-B-B-A e detecta aquecimento ou cansaço na sessão.
- **Teste de tiro do Campo de Tiro (Difícil)**: 30 bots que aparecem, se movem e agacham. Faixas
  da comunidade (sem fonte oficial): Ouro 15–18, Platina 18–22, Diamante+ 22–28. → Os abates são
  tratados como binomiais (n = 30). O app diz se a diferença entre duas sens é real ou pode ser
  sorte e oferece "mais 1 tentativa de cada".
- **Limiar de percepção da sens (JND)**: não foi encontrado estudo com o menor % de mudança de sens
  que um jogador percebe. Por isso o app usa a faixa em que o desempenho fica a até 3% do pico como
  "diferença que você dificilmente sente", em vez de inventar um número.
- **Crosshair placement**: guias concordam que deixar a mira na altura da cabeça reduz a correção
  vertical, mas não há medição publicada. → No teste do navegador, as cabeças ficam na mesma altura
  e o app mede quanto você precisa corrigir na vertical.

- **Variação entre dias**: o efeito de aprendizado e a variação entre tentativas (KovaaK's, 2024)
  mostram que uma sessão sozinha tem ruído. → O app guarda as sessões e consolida a sens de vários
  dias, normalizando cada dia.

## Teste no navegador × jogo

Por que a mesma sens pode parecer diferente no site e no Valorant:

- **Tamanho da janela**: o giro em graus é igual, mas numa janela menor que o monitor a mira anda
  menos pixels por segundo e parece mais lenta. Solução: tela cheia (Fullscreen API).
- **Escala do Windows / aceleração**: sem `unadjustedMovement` (Firefox, Safari), o navegador pode
  entregar o movimento já com a aceleração do sistema. Com escala de tela, alguns navegadores
  reportam `movementX` dividido pela escala. Solução: calibrar com um objeto de tamanho conhecido
  (cartão 8,56 cm ou A4 29,7 cm) e corrigir as contagens.
- **FPS e latência**: abaixo de ~90 FPS a mira parece pesada. `pointerrawupdate` reduz a latência.
- **Sem recoil nem movimento de personagem**: por isso o resultado deve ser confirmado no Campo de Tiro.

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
- https://ieee-cog.org/2022/assets/papers/paper_64.pdf
- https://research.nvidia.com/publication/2022-08_mouse-sensitivity-first-person-targeting-tasks
- https://pmc.ncbi.nlm.nih.gov/articles/PMC10925653 (KovaaK's, Frontiers 2024)
- https://researchonline.ljmu.ac.uk/id/eprint/22512/1/s00221-024-06784-0.pdf (sub-movimentos, 2024)
- https://www.switchbladegaming.com/valorant/aim-training-guide-2/ (Teste de tiro, 30 bots)
- https://dignitas.gg/articles/blogs/Unknown/14416/a-comprehensive-guide-on-warming-up-in-valorant
- https://gwern.net/doc/design/2008-casiez.pdf (ganho controle-tela, Casiez 2008)
