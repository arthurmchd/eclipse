---
tipo: módulo
arquivo: src-tauri/src/application/opgg.rs
camada: aplicação
testes: src-tauri/tests/application/opgg.rs
tags: [módulo]
---

# opgg

> Pede o perfil de uma conta do League ao endpoint público do OP.GG, lê o formato de texto dele e devolve o mesmo bloco `stats.lol` que a API oficial grava.

## Responsabilidade

- Montar o pedido JSON-RPC `tools/call` da ferramenta `lol_get_summoner_profile`, pedindo só os campos de elo.
- Separar o perfil inexistente das outras falhas no envelope JSON-RPC.
- Ler o formato de texto do OP.GG e conferir cada campo.
- Dizer se um bloco novo é mais recente que o salvo.
- **Não** faz a chamada de rede: quem chama, espaça e trata o status HTTP é o [[rankApi]].

## API pública

| Nome | Tipo | Descrição |
|---|---|---|
| `ENDPOINT` | constante | `https://mcp-api.op.gg/mcp` |
| `profile_request(nome, tag, servidor)` | função | Corpo do `POST`. O servidor vai como o rótulo do [[rankApi]] (`BR`, `EUW`, `KR`…) |
| `tool_text(resposta)` | função | Texto da ferramenta, ou `OpggError::NotFound` ("not found" na mensagem) ou `Failed` com texto fixo |
| `parse_text(texto)` | função | Lê o formato próprio para JSON; `None` se qualquer parte não bater |
| `lol_from_profile(perfil, hora)` | função | Bloco `{ level, iconId, solo, flex, updatedAt, source: "opgg" }` |
| `is_newer(bloco, salvo)` | função | Verdadeiro se o bloco é mais recente que o salvo, ou se o salvo não tem hora |

## Dependências

- Usa: `serde_json`, `chrono`.
- Usado por: [[rankApi]] (`fetch_opgg`), e o [[rankWatcher]] apaga a marca `source`.

## Invariantes e decisões

- **Fonte principal sem chave.** Desde 2026-11-15 ([[ADR-037 Elo do League pelo OP.GG]]), por decisão do usuário. Só o League: o endpoint não tem elo de TFT nem de VALORANT por conta.
- **Formato.** Linhas `class Nome: campo,campo` declaram os campos de cada tipo. Depois de uma linha vazia vem o valor: `Nome(arg, …)` com os argumentos na ordem declarada, listas `[…]`, textos em aspas no padrão do JSON, números, `null`, `true` e `false` (também `None`, `True` e `False`). Tipo não declarado, número de argumentos diferente, texto sobrando no fim, mais de 64 níveis ou resposta acima de 256 KB fazem a leitura inteira falhar.
- **Conferência dos campos.** Elo só da lista de Ferro a Desafiante. Divisão de 1 a 4 (ou `I` a `IV`), vazia em Mestre ou acima. PdL, vitórias, derrotas e nível de 0 a 1.000.000. Faltando qualquer um desses, a fila fica sem elo. O ícone só entra como o número de `profileIcon<n>.` na URL. Os cortes vêm de `high_leagues` (`CHALLENGER` e `GRANDMASTER`, `lp_threshold`), só em Mestre ou acima.
- **Hora do dado, não da consulta.** `updatedAt` é o `updated_at` do perfil no OP.GG, convertido para UTC. Sem ele, vale a hora da consulta.
- **Cada consulta pede ao OP.GG que atualize o perfil, mas devolve o dado anterior.** Conferido em 2026-11-15 com um perfil público: depois de uma consulta do Eclipse, o `updated_at` passou a ser o segundo dela, e a resposta tinha vindo com o valor de antes. O OP.GG só aceita nova atualização 2 minutos depois (`renewable_at`). Na prática, o elo chega com o atraso de um ciclo do [[refresher]].
- **Vale o mais novo.** O [[rankApi]] só troca o `stats.lol` salvo se `is_newer` for verdadeiro. Uma leitura do jogo ou da API oficial mais recente fica.

## Testes

`src-tauri/tests/application/opgg.rs`, com rede falsa:

- leitura de um perfil no formato real, com Mestre, cortes, Flex e hora em outro fuso;
- divisões, elos, números e ícone fora da faixa;
- textos com escapes e acentos;
- recusa de tipo desconhecido, tamanho errado, texto sobrando, aspas sem fechar, aninhamento fundo e resposta enorme;
- o envelope JSON-RPC e o corpo em `text/event-stream`;
- `is_newer`;
- a marca `source` apagada pela leitura do jogo ([[rankWatcher]]);
- e, pelo [[rankApi]]: sem chave o pedido sai com o Riot ID e o servidor da conta, uma leitura do jogo mais nova fica, a chave recusada cai no OP.GG, o OP.GG ocupado (429), o perfil inexistente e a resposta ilegível mantêm o elo salvo com erro fixo, e há 1 s entre contas.

## Pontos de atenção

- O endpoint não é documentado nem garantido. Se mudar o formato, a leitura falha inteira e o cartão fica com o elo anterior; o erro fica em `stats.errors.lol`.
- O OP.GG recebe o Riot ID e o servidor de cada conta salva, do mesmo IP ([[Segurança e privacidade]]).
- O limite de pedidos do endpoint não é conhecido. 1 s entre contas foi uma escolha conservadora.
