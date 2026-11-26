---
tipo: módulo
arquivo: src-tauri/src/integration/manager/manager_host.rs
camada: integração
testes: src-tauri/tests/integration/manager/manager_host.rs
tags: [módulo, interface]
---

# managerHost

> Recebe os comandos da webview dos [[cards]] pelo comando único `manager` do Tauri, confere quem chamou e repassa ao serviço de contas.

## Responsabilidade

Valida cada chamada do comando `manager`: só a webview `cards`, no endereço exato da página dos cartões, com um método da lista e argumentos limitados. Repassa ao [[managerService]] pelo transporte `request`, trata localmente as ações na janela da Riot e monta o script de inicialização da webview com o [[manager-preload]]. A webview em si é criada pela janela da sobreposição ([[riotOverlay]], `overlay_window.rs`). Fechar a webview não encerra o serviço nem o login.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `ManagerHost::new(request, window_action)` | construtor | `request(método, args)` leva ao [[managerService]]; `window_action(ação)` recebe `minimize` ou `close` e devolve se deu certo |
| `invoke(quem, método, args)` | método | Confere quem chamou e o comando e devolve o resultado ou um erro genérico |
| `open_external(url)` | método | Manda um link `https:` ao serviço como `openExternal` |
| `trusted(quem)` | função | Só a webview `cards` (`CARDS_LABEL`) no endereço exato dos cartões |
| `bridge_script()` | função | O [[manager-preload]] embutido, ligado ao `invoke` do Tauri e, desde a 2.29.0, à visibilidade da página |
| `COMMAND`, `METHODS`, `WINDOW_ACTIONS` | constantes | `manager`, os métodos e `minimize`/`close`/`drag` |
| `MAX_ARGS`, `MAX_BYTES` | constantes | 4 argumentos e 32 KB |
| `UNTRUSTED`, `INVALID`, `FAILED` | constantes | As mensagens fixas de recusa e de falha |

## Dependências

- Usa: [[manager-preload]] (`include_str!`), `url` e o transporte `request` que o [[main]] liga ao [[managerService]].
- Usado por: [[main]] (o comando `manager` do Tauri) e pela janela da sobreposição do [[riotOverlay]], que cria a webview com o `bridge_script` e leva links `https:` ao `open_external`.

## Invariantes e decisões

- **Fundo fixo.** A webview dos cartões tem fundo `#f2f2f2` enquanto a página carrega.
- **Só a sobreposição.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), o único pai é a janela do [[riotOverlay]]. O comando `closeManager` saiu. A lista de métodos ficou com os onze que os [[cards]] usam: `init`, `events`, `operation`, `saveAccount`, `deleteAccount`, `refresh`, `runningGames`, `signIn`, `cancelSignIn`, `saveSettings` e `openExternal`.
- **Uma janela só.** Os cartões são uma webview filha da janela da sobreposição, nunca uma janela própria.
- **Origem de chamada exata.** A capacidade do Tauri só libera o comando `manager` para a webview `cards`; mesmo assim, o Rust confere o rótulo e o endereço exato `http://eclipse.localhost/src/renderer/cards.html` ([[assetProtocol]]). A página da Riot e outras webviews não ganham a API.
- **Sem isolamento de contexto.** O Tauri não tem o `contextIsolation` do Electron: a ponte vive no mesmo mundo da página. A defesa é a validação no Rust e a lista fechada de páginas do [[assetProtocol]] ([[ADR-033 Sobreposição no Tauri]]).
- **Sem navegação para fora.** A webview só navega na própria página; janelas novas e downloads são recusados. Um link `https:` aberto pelos cartões vira a ação `openExternal` do serviço, para abrir no navegador padrão.
- **Permissões negadas.** A webview recusa todos os pedidos de permissão do navegador.
- **Comandos fechados.** Só os métodos de gerenciamento conhecidos, com lista de até quatro argumentos e até 32 KB, atravessam o comando. O [[managerService]] faz a validação semântica adicional.
- **Coluna de login livre.** A posição e o tamanho da webview vêm do `cards_rect` do [[riotOverlay]], que deixa a coluna de login livre ([[ADR-013 Caixa para ocultar as contas na coluna de login]]).
- **Ações na janela do Riot são locais.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): `windowAction` com exatamente um texto de `WINDOW_ACTIONS` chama `window_action`, que vai ao [[riotOverlay]], e não chega ao serviço de contas. Responde `{ ok: true }` só quando o handler devolve `true`; falha ou outro valor vira `{ ok: false }`, sem detalhes. Outros formatos são recusados como comando inválido. Substitui o aviso `setModal`, que saiu junto com a região própria de diálogo do [[riotOverlay]]. Desde 2026-11-06 a lista tem só `minimize` e `close`: `reveal` saiu com a cópia do perfil dos [[cards]] e passou a ser recusado como comando inválido. Desde 2026-11-21 inclui `drag`, o arraste pela área dos cartões ([[ADR-041 Arraste da Riot pela área do Eclipse]]), também sem argumentos além do nome.
- **Falha sem dados do formulário.** Erros do transporte voltam com uma mensagem fixa, sem ecoar argumentos de cadastro, senhas ou chaves.

## Testes

`src-tauri/tests/integration/manager/manager_host.rs` confere: comandos aceitos só da webview `cards` no endereço exato; comandos inválidos e cargas grandes demais sem chegar ao serviço; `windowAction` tratado localmente e só com as três ações; falhas do serviço com mensagem genérica, sem ecoar credenciais; só links `https:` abertos fora; e o `bridge_script` reaproveitando o [[manager-preload]] sobre o comando `manager`. A criação da webview e suas proteções não têm teste automático. Não carregam contas reais nem autenticam na Riot.

## Pontos de atenção

- A webview dos cartões vive enquanto a janela da sobreposição existe; o estado não sensível fica na página.
- Os dados persistidos continuam no [[store]], sob responsabilidade do processo do Eclipse.
