---
tipo: módulo
arquivo: src-tauri/src/platform/windows/toasts.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/toasts.rs
tags: [módulo, tauri]
---

# toasts

> Mostra os avisos do [[notices]] como notificações do Windows, no lugar dos balões da bandeja do Electron.

## Responsabilidade

- Implementar o `Notifier` com o `tauri-winrt-notification`: título, texto, sem som, e o clique chamando o gancho que abre as contas.
- **Não** decide quando avisar.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `WindowsToasts` | struct | `new(app_id, on_click)`; implementa `Notifier` |
| `app_id(debug, identifier)` | função | O identificador do app instalado, ou o do PowerShell em desenvolvimento |

## Dependências

- Usa: [[notices]] e o crate `tauri-winrt-notification`.
- Usado por: [[main]].

## Invariantes e decisões

- **O app instalado assina com `Eclipse.AccountManager`.** O Setup do Tauri grava esse identificador no atalho do menu Iniciar, e é por ele que o Windows mostra o nome e o ícone do Eclipse. Em desenvolvimento não há atalho, então as notificações saem em nome do PowerShell ([[ADR-034 Troca do Electron pelo Tauri]]).
- **Nada bloqueia quem avisa.** A notificação é montada e mostrada numa thread própria, e o clique roda em outra; quem chama `show` volta na hora.

## Testes

`src-tauri/tests/platform/windows/toasts.rs` confere o identificador nos dois modos. Mostrar uma notificação de verdade não roda no `cargo test`.

## Pontos de atenção

- Conferir na primeira vez que o app instalado rodar: o nome e o ícone da notificação e se o clique abre as contas. O clique pode não funcionar depois que a notificação vai para a central de notificações.
