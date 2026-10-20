# Sens Finder — Valorant

Encontre a sensibilidade ideal **exclusivamente para o Valorant**.

- **Teste de mira no navegador** com a mesma câmera do jogo: 0,07° por contagem × sens, FOV 103°
  e entrada crua do mouse (Pointer Lock com `unadjustedMovement`).
- **Busca A/B cega** (estilo PSA): a cada rodada você testa uma sens mais baixa e uma mais alta,
  sem saber qual é qual, e o intervalo se estreita até convergir.
- **Medição objetiva**: throughput (Lei de Fitts), precisão, tempo de flick e de micro-ajuste e
  overshoot. O app sugere a melhor opção, mas a decisão final é sua.
- **Ponto de partida inteligente**: considera a sua sens atual (ou a de outro jogo), o estilo de
  mira, o mousepad e a função, com base nos dados de pros de 2026.
- **Modo "no jogo"**: testa no Campo de Tiro do Valorant, com abates anotados por rodada.
- **Calculadora**: eDPI, cm/360, troca de DPI, conversão de CS2/Apex/OW2 e zoom das miras.
- **Guia 2026**: o que os pros usam e o que mudou no jogo. Veja também `docs/pesquisa-2026.md`.

## Rodar

É um site estático, sem build:

```bash
npm start          # http://localhost:8080
npm test           # testes da matemática e da busca
```

Também funciona no GitHub Pages (servir a raiz do repositório).

Para o teste no navegador, use o Chrome ou o Edge no PC, com o **mesmo DPI** que você usa no jogo.

## Estrutura

| Arquivo | Função |
|---|---|
| `js/valorant.js` | Constantes e matemática do Valorant, distribuição dos pros e ponto de partida |
| `js/finder.js` | Busca A/B cega com intervalo que se estreita a cada rodada |
| `js/scoring.js` | Pontuação (Fitts, precisão, overshoot) e comparação A × B |
| `js/drill.js` | Teste de mira em canvas com a câmera do Valorant |
| `js/app.js` | Interface |
| `tests/` | Testes com `node --test` |

Projeto não afiliado à Riot Games.
