---
tipo: decisão
status: aceita
data: 2026-11-24
tags: [adr, interface, segurança, desempenho]
---

# ADR-052 Webviews da sobreposição num processo só

## Contexto

Quarta otimização do relatório de 2026-11-24 ([[Medição de CPU e memória]]), aplicada a pedido do usuário. A janela da sobreposição tem três webviews: os [[cards]], a cobertura da coluna de login ([[overlayCover]]) e a caixa "Ocultar contas" ([[overlayToggle]]). Na WebView2 cada uma ganhava um processo de renderização próprio. A cobertura e a caixa usavam ainda o perfil anônimo, e um processo de renderização só serve a um perfil: mesmo que o Chromium quisesse juntar as páginas, não poderia.

Medido na 2.28.4, com a sobreposição escondida: 8 processos da WebView2 e 221 MB privados. As três páginas vêm da mesma origem (`http://eclipse.localhost`, pelo [[assetProtocol]]).

## Decisão

- A WebView2 recebe `--renderer-process-limit=1` junto dos argumentos que já tinha.
- A cobertura e a caixa deixam o perfil anônimo e usam o mesmo perfil dos cartões.
- As três páginas, da mesma origem, passam a dividir um processo de renderização.
- O resto do isolamento continua: a cobertura roda com JavaScript desligado e sem comando nenhum; a caixa só tem o comando `overlay_toggle`, com um booleano; os cartões só têm o comando `manager`. O Rust continua conferindo o rótulo e o endereço de quem chama cada comando ([[managerHost]], [[main]]).

## Alternativas consideradas

- **`--process-per-site`:** junta só as páginas do mesmo site, o que aqui dá no mesmo. O limite é mais simples de conferir: um processo de renderização.
- **Uma página só com a cobertura e a caixa dentro dos cartões:** juntaria também os comandos das três numa página, e a região de cliques e a visibilidade das partes teriam de ser refeitas.
- **Deixar como estava:** dois processos a mais, que existem enquanto o Eclipse está aberto, mesmo com a Riot fechada.

## Consequências

- Esperado: dois processos de renderização a menos, conferidos depois de instalar contando os processos `--type=renderer` filhos do Eclipse; se não juntassem, esta decisão voltaria atrás.
- **Medido na 2.29.0 instalada, com a Riot visível e os cartões à vista:** 2 processos de renderização em vez de 3. Juntou um a menos, não os três. Pela memória de cada um logo depois de abrir (44 MB e 20 MB), os cartões ficaram sozinhos num e a cobertura e a caixa dividem o outro. A WebView2 foi de 9 processos e 288 MB privados para 8 processos e 258 MB; os processos de renderização, de 97 MB para 65 MB. A decisão fica: o ganho existe, e o custo de isolamento descrito abaixo já valia para o caso de um processo só.
- Hipótese, não conferida: o processo dos cartões já estava preso ao site quando as outras duas webviews pediram processo para a página vazia inicial, e o limite do Chromium é só uma meta. Para juntar as três, um teste fora do repositório pode criar as três webviews antes de qualquer uma navegar.
- Sai o isolamento por processo e por perfil entre as três páginas. As três são fixas, locais, servidas por lista fechada, sem script de fora, e nenhuma navega para outra página. A mais exposta é a dos cartões, que mostra Riot IDs e dados do OP.GG e já tem o comando mais forte; dividir o processo com a caixa daria a ela no máximo o comando de um booleano.
- No mesmo perfil, a caixa e a cobertura veriam o armazenamento da origem dos cartões. Nenhuma das três páginas guarda nada no navegador hoje (sem `localStorage`, `IndexedDB` ou cookies).
- Uma falha que derrube o processo de renderização apaga as três páginas juntas, em vez de uma.
- Se outra webview com outra origem entrar no Eclipse, o limite também vale para ela; o isolamento entre sites do Chromium pode passar do limite quando precisar.

## Relacionado

- [[riotOverlay]]
- [[overlayCover]]
- [[overlayToggle]]
- [[Segurança e privacidade]]
- [[ADR-033 Sobreposição no Tauri]]
- [[Arquitetura]]
