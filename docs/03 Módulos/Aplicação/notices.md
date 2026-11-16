---
tipo: módulo
arquivo: src-tauri/src/application/notices.rs
camada: aplicação
testes: src-tauri/tests/application/notices.rs
tags: [módulo, tauri]
---

# notices

> Decide quais avisos da bandeja o Eclipse em Tauri mostra e com que texto; no Electron, isso eram os `displayBalloon` do [[main]].

## Responsabilidade

- Transformar uma operação de login que falhou, um status que precisa de atenção e um erro da sobreposição em um aviso com título e texto.
- **Não** mostra nada: a trait `Notifier` fica com o [[toasts]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `Notice` | struct | Título e texto |
| `Notifier` | trait | `show(&Notice)` |
| `operation_notice(operation, language)` | função | Aviso de jogo que não abriu, se `status` for `failed` |
| `status_notice(payload, language)` | função | Aviso de login que precisa de atenção, se `needsAttention` for `true` |
| `error_notice(message, language)` | função | Aviso com o nome do app e a mensagem traduzida |
| `clip`, `MAX_CHARS`, `APP_NAME` | função e constantes | Corte em 240 caracteres e o nome "Eclipse" |

## Dependências

- Usa: [[language]].
- Usado por: [[main]].

## Invariantes e decisões

- **Os mesmos avisos do Electron.** Jogo que não abriu, login que precisa de atenção e erro da sobreposição, com os mesmos títulos de [[language]]. Nada novo aparece na tela ([[ADR-034 Troca do Electron pelo Tauri]]).
- **Só textos que já iam para a tela.** O texto vem da operação ou do status que os cartões já recebem, ou de uma mensagem traduzida; nenhum nome de conta, usuário ou senha.
- **Corte por caractere, não por byte.** 240 caracteres, como o `slice(0, 240)` do JS, sem partir um acento.

## Testes

`src-tauri/tests/application/notices.rs` cobre os três avisos nos dois idiomas, os casos que não viram aviso e o corte.
