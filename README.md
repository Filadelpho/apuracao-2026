# Apuração 2026 · 2º turno

Projeto de dados sobre a apuração da eleição presidencial brasileira de 2026, com duas partes:

1. **Coletor**: grava o feed oficial do TSE minuto a minuto durante a apuração do 2º turno (25/10/2026).
   O TSE mostra só o momento atual; o histórico da contagem só existe para quem gravou.
2. **Site**: placar e mapa dos 5.570 municípios, ao vivo no domingo, com comparação ao 1º turno.

Depois da eleição, os dados gravados alimentam a análise (pasta `analise/`).

## Inspiração e diferenciais

A ideia veio do [seuimposto.com](https://seuimposto.com/), painel de apuração que circulou muito no
1º turno. Este projeto parte do mesmo formato (placar e mapa por município com dados do TSE) e foca
no que importa para um trabalho de dados:

| | Este projeto |
|---|---|
| **Comparação com o 1º turno** | O mapa "Mudança vs. 1º turno" mostra, município por município, para que lado o eleitorado andou entre os dois turnos. |
| **Histórico guardado e verificável** | O coletor grava cada arquivo do TSE do jeito que veio, com a assinatura digital original. Dá para reconstruir a apuração minuto a minuto e provar que os números vieram do TSE. |
| **Dados e código abertos** | Todo o caminho, do feed do TSE ao mapa, está neste repositório e pode ser reproduzido com os comandos de [Como rodar](#como-rodar). |
| **Análise depois da eleição** (em andamento) | Os dados coletados vão virar estudo: evolução da contagem, mudança entre turnos, cruzamento com indicadores do IBGE e um teste de previsão do resultado a partir da apuração parcial. |
| **Funciona em qualquer tela** | O mesmo site abre no computador e no celular, com tema claro e escuro. No celular, um dedo rola a página e dois dedos movem o mapa. |
| **Sem coleta de dados de quem visita** | Não pede e-mail, não exibe anúncios e não usa rastreamento. |

Projeto independente, sem vínculo com o TSE nem com o seuimposto.com.

## Fontes

- **Resultados**: feed público do TSE em `resultados.tse.jus.br/oficial/ele2026/`. Em 2026 os arquivos
  são JWS (JSON assinado com EdDSA pelo TSE). Os arquivos originais são guardados sem alteração em
  `dados/brutos/`, o que permite verificar a assinatura depois.
- **Malha municipal**: API de malhas do IBGE (`servicodados.ibge.gov.br/api/v3/malhas`).

### Arquivos do TSE usados

| Arquivo | Conteúdo |
|---|---|
| `config/mun-e<ele>-cm.jws` | lista de municípios: código TSE, código IBGE e nome |
| `dados/<uf>/<uf>-e<ele>-ab.jws` | andamento por município: seções totalizadas e hora |
| `dados/<uf>/<uf><mun>-c0001-e<ele>-u.jws` | resultado para presidente (Brasil, UF ou município) |

Códigos das eleições de presidente: `6257` (1º turno) e `6258` (2º turno).

## Como rodar

Pré-requisitos: Python 3.12 e Node.js 24.

```bash
# coletor
python -m venv coletor/.venv
coletor/.venv/Scripts/python -m pip install httpx==0.28.1
coletor/.venv/Scripts/python coletor/preparar_base.py      # 1º turno + malha do IBGE (~5 min)

# site
npm --prefix site install
npm --prefix site run malha                                 # simplifica a malha para TopoJSON
npm --prefix site run dev
```

No domingo:

```bash
coletor/.venv/Scripts/python coletor/coletar.py --turno 2t --intervalo 30
```

A cada rodada o coletor lê o andamento das 28 UFs (27 + exterior) e baixa só os municípios
que tiveram seções novas.

## Observações sobre os dados

- Os totais do 1º turno somados por município batem exatamente com o total do Brasil
  (Lula 53.879.538, Flávio Bolsonaro 56.104.503, válidos 119.300.788).
- Boa Esperança do Norte (MT, IBGE 5101837), município recente, ainda não está na malha do IBGE.
  Seus votos entram nos totais, mas ele não aparece no mapa.
- Cidades no exterior não têm código IBGE; no JSON do site usam a chave `zz<código TSE>`.

## Estrutura

```
coletor/   tse.py (cliente do feed), preparar_base.py, coletar.py
site/      Vite + TypeScript + d3-geo; mapa em canvas
analise/   notebooks (depois da eleição)
dados/     downloads e arquivo bruto (fora do git)
```
