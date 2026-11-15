---
tipo: módulo
arquivo: src-tauri/src/riot/riot_app_controls.rs
camada: riot
testes: src-tauri/tests/riot/riot_app_controls.rs
tags: [módulo]
---

# riotAppControls

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Fecha o Riot Client do mesmo jeito que o botão de fechar da própria Riot, para a cópia desse botão nos [[cards]].

## Responsabilidade

Repete a decisão do botão de fechar da Riot: mandar o cliente para o segundo plano ou sair de vez. Lê as mesmas configurações que a interface da Riot lê e faz o pedido correspondente ao serviço local, pelo [[riotTransport]]. Não fecha a janela; quando a Riot sairia de vez, o [[riotOverlay]] pede ao [[riotWindowObserver]] que feche a janela, como o `QuitUX` da Riot. Não minimiza e não mostra o aviso do app do Xbox. Decisão: [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createRiotAppControls({ request })` | função | Recebe o `localApi` (método, caminho) e devolve `{ close() }`. |
| `close()` | método async | Lê as seis informações em paralelo e envia um único POST. Devolve `'background'` ou `'quit'`. Falha se o serviço não responder ou recusar o POST. |
| `closeMode(valores)` | função | A decisão pura, sem rede. |
| `CLOSE_READS` | objeto | Os caminhos lidos. |
| `SWITCH_TO_BACKGROUND`, `QUIT` | texto | `/riot-client-lifecycle/v1/quit/switch-background-mode` e `/riot-client-lifecycle/v1/quit`. |

## Dependências

- Usa: nada além do `request` injetado.
- Usado por: [[riotClient]] (`closeClient`), que o [[main]] passa ao [[riotOverlay]].

## Invariantes e decisões

- **Mesma regra da Riot.** Tirada da interface da Riot (`AppControls` e `UxService.quit`, lidos só para consulta na cópia privada em 2026-11-04):
  1. Se o app do Xbox está aberto, o aviso dele não foi dispensado e o jogador não ligou "rodar em segundo plano", vai para o segundo plano. É o que o único botão do aviso da Riot faz.
  2. Se a flag `lifecycle.backgroundRunning` está desligada e o lançamento não veio do Xbox, sai.
  3. Se a opção do jogador `enable_run_in_background_set_by_player` está ligada (ou não é booleana, o padrão da Riot) ou a linha de comando tem `--launch-background-mode`, vai para o segundo plano.
  4. Se o lançamento veio do Xbox, vai para o segundo plano.
  5. Senão, sai.
- **Leitura que falha não decide.** Cada leitura com resposta fora de 2xx (por exemplo 404 de uma opção nunca salva) vale como ausente. Se o serviço local não responde, `close` falha antes de qualquer POST.
- **Um POST só.** Nada é repetido. Uma resposta fora de 2xx vira o erro fixo `The Riot Client did not accept the close request`. O [[riotOverlay]] trata qualquer falha fechando só a janela, como Alt+F4.
- **Não é o encerramento do Eclipse.** Parar um cliente travado durante o login continua com `/process-control/v1/process/quit` em [[riotClient]], que encerra mesmo com o segundo plano ligado. Este módulo só serve ao clique do usuário no X.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/riot/riot_app_controls.rs`, testes em `src-tauri/tests/riot/riot_app_controls.rs`. Mesma regra do botão de fechar da Riot; as seis leituras são feitas uma depois da outra em vez de juntas.

## Testes

`test/riot/riotAppControls.test.js` confere a tabela de decisão (flag, opção do jogador e valores não booleanos, linha de comando, Xbox e aviso dispensado). Com transporte falso, confere que as seis leituras acontecem, que vai um POST para o segundo plano ou para sair, e que uma recusa gera erro sem segundo POST. Também confere que um serviço inalcançável falha sem POST. Não fala com a Riot real.

## Pontos de atenção

- Os caminhos e a regra vêm da versão da interface da Riot lida em 2026-11-04. Se uma atualização mudar o `UxService.quit`, a cópia pode divergir; confira ao seguir [[Atualização do Riot Client]].
- Não foi conferido com a Riot real aberta.
