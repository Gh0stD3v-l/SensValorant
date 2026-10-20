# Sens Finder — Valorant

Encontre a sensibilidade ideal **exclusivamente para o Valorant**.

- **Busca adaptativa A/B cega**: em cada rodada você testa uma sens mais baixa e uma mais alta, sem
  saber qual é qual. Se você escolhe o mesmo lado duas vezes, a busca continua andando nessa direção;
  se alterna, ela estreita até convergir. Dá para parar quando estiver confortável.
- **Campo de Tiro do Valorant**: você anota os abates do Teste de tiro (Difícil) e marca como sentiu a
  mira (passou do alvo, chegou curto, tremendo, confortável). A ordem A-B-B-A evita que o cansaço
  favoreça uma sens.
- **Teste no navegador** com a câmera do Valorant (0,07° × sens, FOV 103°, entrada crua, tela cheia):
  agentes com cabeça e corpo, flicks, viradas, micro-ajustes, strafe e peeks.
- **Diagnóstico**: mostra o que você erra (passa do alvo, chega curto, atira com a mira em movimento,
  mira baixa, reação lenta, fica atrás no strafe, perde peeks) e se isso aponta para a sens ou para a técnica.
- **Replay estilo Aim Lab** de cada alvo, em primeira pessoa, com gráfico do caminho da mira.
- **Calibração do mouse** com um cartão ou uma folha A4: corrige a escala do Windows e detecta aceleração.
- **Calculadora** (eDPI, cm/360, DPI, CS2/Apex/OW2, zoom das miras) e **Guia 2026** com dados dos pros.
  Veja `docs/pesquisa-2026.md`.

## Rodar

É um site estático, sem build:

```bash
npm start          # http://localhost:8080
npm test           # testes da matemática e da busca
```

Também funciona no GitHub Pages (servir a raiz do repositório).

Para o teste no navegador, use o Chrome ou o Edge no PC, com o **mesmo DPI** que você usa no jogo,
faça a calibração e deixe a tela cheia ligada. No celular, só o modo Campo de Tiro está disponível.

## Estrutura

| Arquivo | Função |
|---|---|
| `js/valorant.js` | Constantes e matemática do Valorant, distribuição dos pros e ponto de partida |
| `js/finder.js` | Busca adaptativa A/B cega |
| `js/targets.js` | Agentes, tipos de alvo, strafe e detecção de acerto |
| `js/scoring.js` | Pontuação (Fitts × precisão) e comparação A × B |
| `js/analysis.js` | Diagnóstico de erros a partir do caminho da mira |
| `js/scene.js` | Câmera do Valorant e desenho da cena |
| `js/drill.js` | Teste de mira no navegador e medição da calibração |
| `js/replay.js` | Replay em primeira pessoa e gráfico do caminho |
| `js/app.js` | Interface |
| `tests/` | Testes com `node --test` |

Projeto não afiliado à Riot Games.
