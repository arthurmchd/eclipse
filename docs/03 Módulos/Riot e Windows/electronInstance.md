---
tipo: módulo
arquivo: src-tauri/src/platform/windows/electron_instance.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/electron_instance.rs
tags: [módulo, tauri, segurança]
---

# electronInstance

> Diz se o Eclipse em Electron está aberto, para o Eclipse em Tauri não abrir junto com ele.

## Responsabilidade

- Olhar o `lockfile` da pasta de dados real e dizer se o Electron o segura.
- **Não** fecha o Electron nem grava nada.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `electron_running(data_dir)` | função | `true` se o `lockfile` está em uso por quem não deixa escrever |
| `running_with(open, data_dir)` | função | O mesmo, com a abertura do arquivo trocável |
| `lock_file`, `LOCK_FILE`, `SHARING_VIOLATION` | função e constantes | O caminho e o erro 32 do Windows |

## Dependências

- Usa: nada do projeto.
- Usado por: [[main]], antes de qualquer outra coisa.

## Invariantes e decisões

- **Dois Eclipses não abrem juntos.** Os dois usam a mesma pasta de dados; juntos, gravariam o mesmo `data.json`, vigiariam a mesma Riot e desenhariam duas sobreposições ([[ADR-034 Troca do Electron pelo Tauri]]).
- **Só leitura.** O arquivo é aberto para leitura, sem criar, e fechado na hora. Só o erro "em uso" conta como Electron aberto; arquivo ausente, livre ou qualquer outro erro não impedem o Tauri de abrir.
- **Vale também em desenvolvimento**, com a pasta real, porque o Electron aberto mexe na mesma Riot.

## Testes

`src-tauri/tests/platform/windows/electron_instance.rs` confere o caminho, os erros que contam e um arquivo de verdade numa pasta temporária: ausente, livre e preso por outro identificador sem dividir a escrita.
