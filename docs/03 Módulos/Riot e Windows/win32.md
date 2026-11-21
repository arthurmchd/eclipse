---
tipo: módulo
arquivo: src-tauri/src/platform/windows/win32.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/win32.rs
tags: [módulo]
---

# win32

> Chamadas pequenas ao Windows que o [[loginForm]], o [[windowGuard]], o [[riotWindowObserver]] e o [[riotClient]] compartilham: lista de processos, janelas de topo e medidas de janela.

## Responsabilidade

- Lista processos pelo Toolhelp, sem abrir `tasklist`.
- Enumera janelas de topo e lê, de cada uma, processo, caminho do executável, título, classe, retângulos e se está "cloaked".
- Não guarda estado, não muda janelas e não abre processos além da consulta limitada.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `wide(texto)` | função | Texto em UTF-16 terminado em zero |
| `processes()` | função | `(pid, nome do exe)` de cada processo |
| `process_names()` | função | Nomes dos executáveis em minúsculas, para o [[riotClient]] saber o que está rodando |
| `process_ids(nomes)` | função | PIDs cujos nomes, sem `.exe`, batem com algum da lista, sem diferença de maiúsculas |
| `image_path(pid)` | função | Caminho completo do executável, ou vazio |
| `top_windows()` | função | Janelas de topo por `EnumWindows` |
| `process_of`, `process_name`, `window_text`, `class_name`, `is_root`, `window_rect`, `client_rect`, `client_origin`, `cloaked` | `pub(crate)` | Leituras de uma janela, só para os módulos do Eclipse |
| `null_window()` | função | Janela nula |
| `file_version(caminho)` | função | Os quatro números do recurso de versão de um executável (`GetFileVersionInfoW`), ou `None`. Usado pelo [[riotVersion]] |

## Dependências

- Usa: `windows-sys` (`Toolhelp32`, `user32`, `dwmapi`, `kernel32`, `version`).
- Usado por: [[loginForm]], [[windowGuard]], [[riotWindowObserver]], [[riotClient]], [[riotVersion]].

## Invariantes e decisões

- **Lista de processos sem `tasklist` (2026-11-21, [[ADR-044 Helpers do Windows em Rust]]).** O [[riotClient]] abria `tasklist.exe` a cada verificação de jogos. Agora lê o Toolhelp direto. Uma lista vazia é tratada como falha de leitura, como era a falha do `tasklist`.
- **Leituras de janela só dentro do crate.** Elas recebem `HWND`, que em Rust é um ponteiro cru; o Windows valida o identificador, mas o clippy pede que uma função pública com ponteiro cru seja `unsafe`. Como só o Eclipse as usa, ficam `pub(crate)`.
- **Consulta limitada.** O caminho do executável usa `PROCESS_QUERY_LIMITED_INFORMATION`, que não exige privilégio e não deixa mexer no processo. O identificador é fechado na hora.

## Testes

`src-tauri/tests/platform/windows/win32.rs`: a lista acha o próprio processo do teste pelo nome e pelo PID, a busca ignora maiúsculas, um nome inexistente não acha nada, o caminho do executável termina no nome certo, `wide` termina em zero, e `file_version` lê o `kernel32.dll` e devolve `None` para um arquivo inexistente ou uma pasta.

## Pontos de atenção

- Nada específico da Riot aqui; os filtros por nome ficam nos módulos que usam estas funções.
