---
tipo: decisão
status: aceita
data: 2026-11-15
tags: [adr, elos, opgg, privacidade]
---

# ADR-037 Elo do League pelo OP.GG

Decisão do usuário em 2026-11-15, depois de comparar o Eclipse com outros gerenciadores de contas no GitHub: "o opgg seria o principal e ao entrar no lol seria mais como um apoio para as pessoas que costumam jogar muito em uma conta".

## Contexto

Sem chave, o elo vinha só do jogo aberto ([[ADR-031 Elo lido do próprio jogo, sem chave]]). Isso deixava paradas as contas que a pessoa não abre. Para o Eclipse servir a outras pessoas, pedir a cada uma a própria chave da Riot não funciona. A chave pessoal também não pode ir dentro do app.

Dois projetos do GitHub usam o OP.GG sem chave. O LeagueAccounts lê a página do perfil e imita o botão "Atualizar" do site com identificadores internos, que mudam a cada versão. O lost-league-manager usa o endpoint público que o OP.GG abriu para agentes de IA, `https://mcp-api.op.gg/mcp` (protocolo MCP, JSON-RPC por `POST`), que não pede chave.

Conferido em 2026-11-15 só com um perfil público de jogador profissional, nunca com contas do usuário:

- uma única chamada `tools/call` responde, sem `initialize` nem sessão, em `application/json`;
- a ferramenta `lol_get_summoner_profile` (`game_name`, `tag_line`, `region` com o rótulo do servidor, `desired_output_fields`) traz nível, ícone, `updated_at`, e por fila (`SOLORANKED`, `FLEXRANKED`) o elo, a divisão em número, os PdL, as vitórias, as derrotas, a sequência de vitórias e os cortes de Grão-Mestre e Desafiante (`high_leagues[].lp_threshold`);
- a resposta é um texto num formato próprio: linhas `class Nome: campo,campo` e depois o valor como `Nome(arg, …)`, listas `[…]`, textos entre aspas, números e `null`;
- perfil inexistente volta como erro JSON-RPC "Summoner not found";
- não há ferramenta de elo de TFT nem de VALORANT por conta.

## Decisão

- **O OP.GG é a fonte principal do elo do League sem chave.** O refresher passa a consultar todas as contas no intervalo do ⚙ e no ↻, mesmo sem chave. Cada conta é um `POST` ao `mcp-api.op.gg`, pedindo só os campos necessários, com 1 s entre contas.
- **Com chave da Riot, a API oficial vem primeiro**, porque é oficial e traz o dado na hora. O OP.GG entra se ela falhar, por exemplo com a chave de 24 h vencida.
- **O jogo aberto continua corrigindo na hora** a conta em que a pessoa joga ([[rankWatcher]]).
- **Vale o dado mais novo.** O bloco do OP.GG guarda como `updatedAt` a hora em que o OP.GG atualizou o perfil, não a hora da consulta, e leva `source: "opgg"`. Ele só substitui o elo salvo se for mais novo que ele. Uma leitura do jogo ou da API oficial mais recente fica. A leitura do jogo apaga o `source`.
- **TFT e VALORANT não mudam:** o OP.GG não tem o elo deles. Continuam vindo do jogo aberto ou de uma chave.

O código fica no módulo novo [[opgg]] (aplicação): pedido, leitura do formato e conversão para o mesmo bloco `stats.lol` que a API oficial grava. O [[rankApi]] decide a ordem das fontes; o [[refresher]] deixa de pular as contas sem chave.

## Privacidade e segurança

- **O OP.GG recebe o Riot ID e o servidor de cada conta salva**, todos do mesmo IP. Assim ele consegue ligar as contas à mesma pessoa. Nada mais vai: nem login, nem senha, nem sessão.
- A resposta é não confiável. O leitor aceita no máximo 256 KB e 64 níveis de aninhamento, confere cada campo por tipo e faixa (elo numa lista fechada, divisão de 1 a 4, números de 0 a 1.000.000) e descarta o resto. O ícone só entra como número tirado da URL.
- O log só registra linhas fixas, sem Riot ID.
- Se o OP.GG cair, mudar o formato ou limitar os pedidos (429), o cartão fica com o elo anterior e o erro fica em `stats.errors.lol`.

## Conferido depois, no mesmo dia

Pelo cliente HTTP do próprio Eclipse, com o perfil público:

- a chamada real devolveu o bloco certo (Mestre, PdL, vitórias, derrotas, cortes) em 1,9 s;
- **a consulta faz o OP.GG atualizar o perfil, mas a resposta traz o dado anterior.** Antes da consulta, o `updated_at` era 23:04:31 UTC e o perfil já podia ser atualizado desde 23:06:31. A consulta saiu às 23:11:18 e voltou com 23:04:31. A consulta seguinte mostrou `updated_at` 23:11:18, o segundo da consulta do Eclipse. O OP.GG só aceita nova atualização 2 minutos depois (`renewable_at`).

Na prática, o elo do OP.GG chega com o atraso de um ciclo de atualização (30 min por padrão no ⚙). A regra do dado mais novo impede que esse atraso apague um elo exato vindo do jogo.

**Segunda leitura a pedido do usuário.** Também no mesmo dia, o usuário aceitou que uma atualização pedida por ele (↻, salvar as configurações ou salvar uma conta) leia de novo, 8 s depois, as contas que vieram do OP.GG. Medido com o perfil público: depois de uma consulta que pediu a atualização, a consulta seguinte, poucos segundos depois, já trouxe o dado novo. Assim, o clique manual traz o dado fresco. O preço é o dobro de consultas nesses cliques. As atualizações automáticas continuam com uma leitura só ([[refresher]]).

## Não conferido

- O limite de pedidos do endpoint. Não há documentação; 1 s entre contas foi uma escolha conservadora.
- Contas reais do usuário, contas sem elo e servidores além do KR.

## Alternativas consideradas

- **Imitar o botão "Atualizar" do site**, como o LeagueAccounts. Traz o dado fresco, mas depende de identificadores internos do site, que mudam sem aviso. Quando quebrasse, o elo de todo mundo pararia até sair uma versão nova.
- **Chave de produção num servidor próprio.** É oficial e fresca, mas exige aprovação da Riot e um servidor no ar. Fica para se o Eclipse crescer.
- **Só o jogo aberto.** Não pede rede externa, mas deixa paradas as contas que a pessoa não abre.
